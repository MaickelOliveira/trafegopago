import { createHash, randomUUID } from "node:crypto";
import { after } from "next/server";
import { getAllAgentConfigs, getClientById } from "./clients";
import { readDocument, withDataTransaction, writeDocument } from "./document-store";
import { getFunnelForConnection } from "./lead-context";
import { leadChatNumber, leadFormMessage, splitLeadMessage, type LeadForm } from "./lead-form";
import { upsertLeadByPhone, type Lead } from "./leads";
import { normalizeRecipient } from "./lead-recipient";
import { sendMessage } from "./whatsapp-send";
import { getTemplates, sendTemplate } from "./waba-templates";

const collection = "lead-deliveries.json";
const minute = 60_000;
const day = 1440 * minute;

type Origin = { contact: string; pixel: boolean; created: number };
type Delivery = Origin & {
  clientId: string; connectionId: string; to: string;
  name: string; phone: string; parts: string[]; index: number;
  due: number; deadline: number; retention: number; attempts: number; claim?: string;
};
type Receipt = Origin & { expires: number };
type Queue = Record<string, Delivery | Receipt>;
function receipt(row: Delivery): Receipt {
  return { contact: row.contact, pixel: row.pixel, created: row.created, expires: Date.now() + row.retention };
}
const readQueue = () => readDocument<Queue>(collection, {});

async function enqueue(clientId: string, funnelId: string, sourceId: string, form: LeadForm, submissionId?: string) {
  const client = await getClientById(clientId);
  if (!client) return [];
  const configs = getAllAgentConfigs(client).filter(cfg => cfg.whatsappConnectionId && cfg.leadRecipients?.length);
  if (!configs.length) return [];
  const jobs = await readQueue();
  const message = leadFormMessage(form);
  const identity = submissionId || JSON.stringify(Object.entries(form.fields).sort(([a], [b]) => a.localeCompare(b)));
  const now = Date.now();
  const pixel = sourceId.startsWith("pixel:");
  const added: string[] = [];
  for (const cfg of configs) {
    const connectionId = cfg.whatsappConnectionId!;
    const funnel = await getFunnelForConnection(clientId, connectionId);
    if (!funnel) continue;
    const meta = funnel.connections?.some(c => c.id === connectionId && c.type === "meta");
    for (const recipient of cfg.leadRecipients ?? []) {
      const to = normalizeRecipient(recipient.type, recipient.value);
      if (!to || (meta && recipient.type === "group")) continue;
      const id = createHash("sha256").update(JSON.stringify([clientId, sourceId, identity, to])).digest("hex");
      const prior = jobs[id];
      if (prior && (!("expires" in prior) || prior.expires > now)) continue;
      // O pixel também observa o submit de sites que já chamam o webhook do CRM.
      // Dê prioridade à ficha do webhook, sem silenciar um novo orçamento direto.
      const contact = createHash("sha256").update(JSON.stringify([clientId, funnelId, leadChatNumber(form.phone) || form.phone, to])).digest("hex");
      const overlapping = Object.entries(jobs).filter(([, other]) => other.contact === contact && other.pixel !== pixel && now - other.created < 90_000);
      if (pixel && overlapping.length) continue;
      if (!pixel) {
        for (const [key, other] of overlapping) {
          if (!("expires" in other) && !other.claim) delete jobs[key];
        }
      }
      jobs[id] = {
        contact, pixel, created: now,
        clientId, connectionId, to, name: form.name, phone: leadChatNumber(form.phone) || form.phone,
        parts: splitLeadMessage(message, meta && cfg.metaSummaryTemplateName ? 650 : 3600), index: 0,
        due: pixel ? now + 15_000 : now, deadline: now + day, retention: submissionId ? 7 * day : 3 * minute, attempts: 0,
      };
      added.push(id);
    }
  }
  if (added.length) await writeDocument(collection, jobs);
  return added;
}

// Confirma o lead e a fila na mesma transação. O envio ao provedor acontece depois do commit.
export async function captureFormLead(clientId: string, phone: string, patch: Partial<Lead>, sourceId: string, form: LeadForm, submissionId?: string) {
  const { lead, ids } = await withDataTransaction(async () => {
    const lead = await upsertLeadByPhone(clientId, phone, patch);
    const ids = await enqueue(clientId, lead.funnelId, sourceId, form, submissionId);
    return { lead, ids };
  });
  if (ids.length && !sourceId.startsWith("pixel:")) after(() => processLeadNotifications(ids));
  return lead;
}

async function sendPart(job: Delivery): Promise<"sent" | "retry" | "cancel"> {
  const client = await getClientById(job.clientId);
  const cfg = client && getAllAgentConfigs(client).find(c => c.whatsappConnectionId === job.connectionId);
  if (!cfg?.leadRecipients?.some(r => normalizeRecipient(r.type, r.value) === job.to)) return "cancel";
  const funnel = await getFunnelForConnection(job.clientId, job.connectionId);
  if (!funnel) return "cancel";
  const part = job.parts[job.index];
  if (await sendMessage(job.to, part, job.clientId, job.connectionId, "recipient")) return "sent";
  const meta = funnel.connections?.find(c => c.id === job.connectionId && c.type === "meta");
  if (!meta?.metaToken || !meta.metaPhoneNumberId || !cfg.metaSummaryTemplateName || job.to.endsWith("@g.us")) return "retry";
  const template = (await getTemplates(job.clientId)).find(t =>
    t.name === cfg.metaSummaryTemplateName && t.status === "APPROVED" && (!t.phoneNumberId || t.phoneNumberId === meta.metaPhoneNumberId)
  );
  if (!template) return "retry";
  const parameters = [job.phone, job.name, part].map(value => ({ type: "text", text: value.replace(/\s*\n+\s*/g, " · ").replace(/\s+/g, " ") }));
  const result = await sendTemplate(meta.metaPhoneNumberId, meta.metaToken, job.to, template.name, template.language, [{ type: "body", parameters }]);
  return result.success ? "sent" : "retry";
}

export async function processLeadNotifications(ids?: string[]): Promise<void> {
  // Limita a varredura por tick; recibos guardam só o vencimento, sem conteúdo pessoal.
  const now = Date.now();
  const snapshot = await readQueue();
  const candidates = ids ?? Object.keys(snapshot).filter(id => {
    const job = snapshot[id];
    return ("expires" in job ? job.expires : job.due) <= now;
  }).slice(0, 100);
  for (const id of candidates) {
    const claim = randomUUID();
    const job = await withDataTransaction(async () => {
      const jobs = await readQueue();
      const row = jobs[id];
      if (!row) return;
      if ("expires" in row) {
        if (row.expires <= Date.now()) { delete jobs[id]; await writeDocument(collection, jobs); }
        return;
      }
      if (row.due > Date.now()) return;
      if (row.deadline <= Date.now()) {
        console.warn("[Receber lead] Entrega expirada", id);
        jobs[id] = receipt(row);
        await writeDocument(collection, jobs);
        return;
      }
      row.claim = claim;
      row.due = Date.now() + 10 * minute;
      await writeDocument(collection, jobs);
      return { ...row };
    });
    if (!job) continue;
    while (job.index < job.parts.length) {
      const result = await sendPart(job).catch(() => "retry" as const);
      const more = await withDataTransaction(async () => {
        const jobs = await readQueue();
        const row = jobs[id];
        if (!row || "expires" in row || row.claim !== claim) return false;
        if (result === "retry") {
          row.due = Date.now() + Math.min(30, 2 ** row.attempts++) * minute;
          delete row.claim;
          console.warn("[Receber lead] Nova tentativa agendada", id);
        } else if (result === "cancel" || ++row.index >= row.parts.length) {
          jobs[id] = receipt(row);
        } else {
          row.due = Date.now() + 10 * minute;
        }
        await writeDocument(collection, jobs);
        return result === "sent" && row.index < row.parts.length;
      });
      if (!more) break;
      job.index++;
    }
  }
}
