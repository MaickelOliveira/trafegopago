import { createHash, randomUUID } from "node:crypto";
import { after } from "next/server";
import { getAllAgentConfigs, getClientById } from "./clients";
import { readDocument, withDataTransaction, writeDocument } from "./document-store";
import { getFunnelForConnection } from "./lead-context";
import { leadChatNumber, leadFormMessage, splitLeadMessage, type LeadForm } from "./lead-form";
import { getLeadByPhone, upsertLeadByPhone, type Lead } from "./leads";
import { normalizeRecipient } from "./lead-recipient";
import { sendMessage } from "./whatsapp-send";
import { getTemplates, sendTemplate } from "./waba-templates";

const collection = "lead-deliveries.json";
const minute = 60_000;
const day = 1440 * minute;

type Origin = { formSubmission?: true; contact: string; pixel: boolean; created: number };
type Delivery = Origin & {
  clientId: string; funnelId?: string; connectionId: string; to: string;
  name: string; phone: string; parts: string[]; index: number;
  due: number; deadline: number; retention: number; attempts: number; claim?: string;
};
type Receipt = Origin & { expires: number };
type Queue = Record<string, Delivery | Receipt>;
function receipt(row: Delivery): Receipt {
  return { formSubmission: row.formSubmission, contact: row.contact, pixel: row.pixel, created: row.created, expires: Date.now() + row.retention };
}
const readQueue = () => readDocument<Queue>(collection, {});

export type LeadNotificationInput = { form: LeadForm; pixel: boolean; submissionId?: string };

function contactKey(clientId: string, funnelId: string, phone: string, to: string) {
  return createHash("sha256").update(JSON.stringify([clientId, funnelId, phone, to])).digest("hex");
}

// Only form intake supplies this input. Repeat submissions can enrich a pending pixel job.
export async function queueCrmLead(lead: Lead, input: LeadNotificationInput, onlyEnrich = false) {
  const { clientId, funnelId } = lead;
  const client = await getClientById(clientId);
  if (!client) return;
  const configs = getAllAgentConfigs(client).filter(cfg => cfg.whatsappConnectionId && cfg.leadRecipients?.length);
  if (!configs.length) return;

  const jobs = await readQueue();
  const { form, pixel } = input;
  const message = leadFormMessage(form);
  const phone = leadChatNumber(form.phone) || form.phone;
  const now = Date.now();
  const changed: string[] = [];

  for (const cfg of configs) {
    const connectionId = cfg.whatsappConnectionId!;
    const funnel = await getFunnelForConnection(clientId, connectionId);
    if (funnel?.id !== funnelId) continue;
    const official = funnel.connections?.some(c => c.id === connectionId && c.type === "meta");
    for (const recipient of cfg.leadRecipients ?? []) {
      const to = normalizeRecipient(recipient.type, recipient.value);
      if (!to || (official && recipient.type === "group")) continue;
      const id = createHash("sha256").update(JSON.stringify([clientId, lead.id, connectionId, to])).digest("hex");
      const prior = jobs[id];
      if (prior && (prior.formSubmission || prior.pixel || (!("expires" in prior) && await isFormDelivery(prior)))) {
        if ("expires" in prior || !prior.pixel || pixel || prior.claim || prior.index !== 0) continue;
      } else if (onlyEnrich) {
        continue;
      }
      jobs[id] = {
        formSubmission: true, contact: contactKey(clientId, funnelId, phone, to), pixel, created: now,
        clientId, funnelId, connectionId, to, name: form.name, phone,
        parts: splitLeadMessage(message, official && cfg.metaSummaryTemplateName ? 650 : 3600), index: 0,
        due: pixel ? now + 15_000 : now, deadline: now + day, retention: input.submissionId ? 7 * day : 3 * minute, attempts: 0,
      };
      changed.push(id);
    }
  }
  if (!changed.length) return;
  await writeDocument(collection, jobs);
  if (!pixel) {
    try { after(() => processLeadNotifications(changed)); }
    catch { /* A criação fora de uma requisição é atendida pelo worker da fila. */ }
  }
}

export function captureFormLead(clientId: string, phone: string, patch: Partial<Lead>, sourceId: string, form: LeadForm, submissionId?: string) {
  return upsertLeadByPhone(clientId, phone, patch, { form, pixel: sourceId.startsWith("pixel:"), submissionId });
}

// Jobs persisted before form-only delivery have no structured origin.
async function isFormDelivery(job: Delivery): Promise<boolean> {
  if (job.formSubmission || job.pixel) return true;
  const message = job.parts.join("\n");
  if (message.startsWith("📋 *Novo lead de formulário*")) return true;
  const origin = message.match(/(?:^|\n)\*Origem:\* ([^\n]+)(?:\n• [^\n]*)*$/)?.[1];
  if (origin === "Formulário da Meta" || origin === "Formulário do site") return true;
  if (!origin || ["WhatsApp", "Cadastro manual", "CRM"].includes(origin) || !job.funnelId) return false;
  const lead = await getLeadByPhone(job.clientId, job.phone, job.funnelId);
  return !!lead?.notes?.split("\n").some(line => line.startsWith("Origem: "))
    && origin === (lead.customFields?.formulario || "Formulário");
}

async function sendPart(job: Delivery): Promise<"sent" | "retry" | "cancel"> {
  if (!await isFormDelivery(job)) return "cancel";
  const client = await getClientById(job.clientId);
  const cfg = client && getAllAgentConfigs(client).find(c => c.whatsappConnectionId === job.connectionId);
  if (!cfg?.leadRecipients?.some(r => normalizeRecipient(r.type, r.value) === job.to)) return "cancel";
  const funnel = await getFunnelForConnection(job.clientId, job.connectionId);
  if (!funnel) return "cancel";
  if (job.funnelId ? job.funnelId !== funnel.id : job.contact !== contactKey(job.clientId, funnel.id, job.phone, job.to)) return "cancel";
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
