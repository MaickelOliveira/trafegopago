import { existsSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import { randomUUID } from "crypto";
import type { Lead } from "./leads";
import { updateLead, getLeads } from "./leads";
import { getFunnels } from "./funnels";
import { sendText, sendList, sendMedia } from "./uazapi";
import { sendText as wppSendText, sendMedia as wppSendMedia } from "./wppconnect-api";
import { markSent } from "./wppconnect-sent";
import { getWppSessions } from "./wppconnect-sessions";
import { getTemplates, sendTemplate } from "./waba-templates";
import type { TemplateComponent } from "./waba-templates";

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * Gatilhos disponíveis:
 * - lead_created     : Lead cadastrado via formulário/webhook
 * - column_changed   : Lead muda para qualquer coluna
 * - column_entered   : Lead criado OU movido para uma coluna específica
 * - scheduled_daily  : Diariamente às HH:MM para todos os leads de uma coluna
 */
export type CrmTrigger =
  | "lead_created"
  | "column_changed"
  | "column_entered"
  | "scheduled_daily";

export type CrmChannel = "uazapi" | "waba";

/**
 * Tipos de passo de ação disponíveis:
 * - send_message  : Enviar mensagem de texto livre (UazapiGO)
 * - send_template : Enviar template aprovado (Meta WABA)
 * - send_list     : Enviar lista interativa WhatsApp (UazapiGO)
 * - add_note      : Adicionar nota/comentário ao lead no CRM
 * - move_column   : Mover lead para outra coluna do kanban
 * - delay         : Pausar N minutos antes do próximo passo
 * - webhook       : Chamar URL externa (HTTP POST com dados do lead)
 */
export type CrmStepType =
  | "send_message"
  | "send_template"
  | "send_list"
  | "add_note"
  | "move_column"
  | "delay"
  | "webhook";

export type ListRow = { id: string; title: string; description?: string };

export type CrmStep = {
  id: string;
  type: CrmStepType;
  // send_message / send_list:
  connectionId?: string;
  message?: string;
  imageUrl?: string;    // opcional: envia imagem + legenda (só UazapiGO)
  // send_template:
  templateId?: string;
  templateVariables?: Record<string, string[]>;
  // send_list:
  listTitle?: string;
  listButtonText?: string;
  listRows?: ListRow[];
  // add_note:
  note?: string;
  // move_column:
  targetFunnelId?: string;
  targetColumnId?: string;
  // delay:
  delayMinutes?: number;
  // webhook:
  webhookUrl?: string;
  webhookBody?: string;
};

export type CrmAutomation = {
  id: string;
  clientId: string;
  funnelId?: string;          // se vazio, vale para qualquer funil do cliente
  name: string;
  active: boolean;
  trigger: CrmTrigger;
  triggerColumnId?: string;   // para column_changed / column_entered / scheduled_daily
  triggerWebhookId?: string;  // para lead_created: filtra por webhook específico (site)
  scheduledTime?: string;     // "HH:MM" para scheduled_daily
  // ── Multi-passo (novo) ──
  steps?: CrmStep[];
  // ── Legacy (single-action, mantido para retrocompatibilidade) ──
  channel?: CrmChannel;
  connectionId?: string;
  message?: string;
  templateId?: string;
  templateVariables?: Record<string, string[]>;
  delayMinutes?: number;
  createdAt: string;
  updatedAt: string;
};

// ── Storage ───────────────────────────────────────────────────────────────────

const FILE = path.join(process.cwd(), "data", "crm-automations.json");

function load(): CrmAutomation[] {
  try {
    if (!existsSync(FILE)) return [];
    return JSON.parse(readFileSync(FILE, "utf-8"));
  } catch { return []; }
}

function save(list: CrmAutomation[]) {
  writeFileSync(FILE, JSON.stringify(list, null, 2));
}

// ── CRUD ──────────────────────────────────────────────────────────────────────

export function getAutomations(clientId?: string): CrmAutomation[] {
  const all = load();
  return clientId ? all.filter((a) => a.clientId === clientId) : all;
}

export function getAutomationById(id: string): CrmAutomation | undefined {
  return load().find((a) => a.id === id);
}

export function createAutomation(data: Omit<CrmAutomation, "id" | "createdAt" | "updatedAt">): CrmAutomation {
  const list = load();
  const now = new Date().toISOString();
  const automation: CrmAutomation = { ...data, id: randomUUID(), createdAt: now, updatedAt: now };
  list.push(automation);
  save(list);
  return automation;
}

export function updateAutomation(id: string, patch: Partial<CrmAutomation>): CrmAutomation | null {
  const list = load();
  const idx = list.findIndex((a) => a.id === id);
  if (idx === -1) return null;
  list[idx] = { ...list[idx], ...patch, id, updatedAt: new Date().toISOString() };
  save(list);
  return list[idx];
}

export function deleteAutomation(id: string): boolean {
  const list = load();
  const next = list.filter((a) => a.id !== id);
  if (next.length === list.length) return false;
  save(next);
  return true;
}

// ── Variable substitution ─────────────────────────────────────────────────────

function interpolate(text: string, lead: Lead, funnelName?: string): string {
  const firstName = (lead.name ?? "").split(" ")[0];
  const fullName  = lead.name ?? "";
  return text
    .replace(/\{\{nome\}\}/gi, firstName)
    .replace(/\{\{nome_completo\}\}/gi, fullName)
    .replace(/\{\{telefone\}\}/gi, lead.phone ?? "")
    .replace(/\{\{email\}\}/gi, lead.email ?? "")
    .replace(/\{\{funil\}\}/gi, funnelName ?? "");
}

function buildMetaComponents(
  tplComponents: TemplateComponent[],
  templateVariables: Record<string, string[]>,
  lead: Lead,
  funnelName?: string,
): object[] {
  const result: object[] = [];
  for (const comp of tplComponents) {
    const varMappings = templateVariables[comp.type];
    if (!varMappings || varMappings.length === 0) continue;
    const parameters = varMappings.map((mapping) => ({
      type: "text",
      text: interpolate(mapping, lead, funnelName),
    }));
    result.push({ type: comp.type.toLowerCase(), parameters });
  }
  return result;
}

// ── Step execution ────────────────────────────────────────────────────────────

type FunnelLike = { id: string; name: string; connections?: { id: string; uazapiToken?: string; metaPhoneNumberId?: string; metaToken?: string }[] };

function findConn(funnels: FunnelLike[], connId: string) {
  return funnels.flatMap((f) => f.connections ?? []).find((c) => c.id === connId);
}

async function executeStep(step: CrmStep, lead: Lead, funnels: FunnelLike[], funnelName?: string) {
  console.log(`[crm-auto] executeStep type=${step.type} stepId=${step.id} leadId=${lead.id} phone=${lead.phone} connId=${step.connectionId ?? "(none)"}`);
  switch (step.type) {
    case "send_message": {
      const conn = findConn(funnels, step.connectionId ?? "");
      console.log(`[crm-auto] send_message: findConn result=${conn ? `id=${conn.id} hasUazapi=${!!conn.uazapiToken}` : "NOT_FOUND"}`);
      if (conn?.uazapiToken) {
        // UazapiGO path
        const msg = step.message ? interpolate(step.message, lead, funnelName) : "";
        console.log(`[crm-auto] UazapiGO send: phone=${lead.phone} msg="${msg.slice(0,50)}" imageUrl=${step.imageUrl ?? "none"}`);
        if (step.imageUrl) {
          await sendMedia(conn.uazapiToken, lead.phone, "image", step.imageUrl, msg || undefined);
        } else if (msg) {
          await sendText(conn.uazapiToken, lead.phone, msg);
        }
      } else {
        // WPPConnect path — procura por UUID e também por sessionName (fallback)
        const allWppSessions = getWppSessions();
        console.log(`[crm-auto] WPP path: looking for sessId=${step.connectionId} among ${allWppSessions.length} sessions: ${allWppSessions.map(s => `${s.id}(${s.sessionName})`).join(", ")}`);
        const wppSess = allWppSessions.find((s) => s.id === step.connectionId)
          ?? allWppSessions.find((s) => s.sessionName === step.connectionId);
        if (wppSess) {
          const msg = step.message ? interpolate(step.message, lead, funnelName) : "";
          // Detecta WhatsApp LID: número com 13+ dígitos que não começa com 55
          const rawPhone = lead.phone.replace(/@.*$/, "").replace(/\D/g, "");
          const isLid = rawPhone.length >= 13 && !rawPhone.startsWith("55");
          console.log(`[crm-auto] WPP send: session=${wppSess.sessionName} phone=${lead.phone} isLid=${isLid} imageUrl=${step.imageUrl ?? "none"} msg="${msg.slice(0,50)}"`);
          if (step.imageUrl) {
            // Envia mídia com legenda (foto/vídeo/documento)
            const ok = await wppSendMedia(wppSess.sessionName, wppSess.sessionToken, lead.phone, step.imageUrl, msg || undefined, isLid);
            console.log(`[crm-auto] WPP sendMedia result=${ok}`);
          } else if (msg) {
            markSent(rawPhone, msg); // evita que o echo fromMe pause a IA
            const ok = await wppSendText(wppSess.sessionName, wppSess.sessionToken, lead.phone, msg, isLid);
            console.log(`[crm-auto] WPP sendText result=${ok}`);
          } else {
            console.log(`[crm-auto] WPP send skipped: message is empty after interpolation`);
          }
        } else {
          console.log(`[crm-auto] WPP send skipped: session NOT found for connId=${step.connectionId}`);
        }
      }
      break;
    }
    case "send_template": {
      const conn = findConn(funnels, step.connectionId ?? "");
      if (!step.templateId || !conn?.metaPhoneNumberId || !conn?.metaToken) return;
      const tpl = getTemplates().find((t) => t.id === step.templateId);
      if (!tpl || tpl.status !== "APPROVED") return;
      const comps = step.templateVariables
        ? buildMetaComponents(tpl.components, step.templateVariables, lead, funnelName)
        : [];
      await sendTemplate(conn.metaPhoneNumberId, conn.metaToken, lead.phone, tpl.name, tpl.language,
        comps.length > 0 ? comps : undefined);
      break;
    }
    case "send_list": {
      const conn = findConn(funnels, step.connectionId ?? "");
      if (!conn?.uazapiToken || !step.listTitle || !step.listRows?.length) return;
      await sendList(conn.uazapiToken, lead.phone, step.listTitle,
        step.listButtonText ?? "Ver opções",
        [{ title: step.listTitle, rows: step.listRows }]);
      break;
    }
    case "add_note": {
      if (!step.note) return;
      const note = interpolate(step.note, lead, funnelName);
      const ts = new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
      const prev = lead.notes ?? "";
      updateLead(lead.id, { notes: prev + (prev ? "\n\n" : "") + `[${ts} — automação] ${note}` });
      break;
    }
    case "move_column": {
      if (!step.targetColumnId) return;
      const patch: Partial<Lead> = { status: step.targetColumnId };
      if (step.targetFunnelId) patch.funnelId = step.targetFunnelId;
      updateLead(lead.id, patch);
      break;
    }
    case "delay":
      // Delays are handled at the scheduling level (see runAutomationsForEvent)
      break;
    case "webhook": {
      if (!step.webhookUrl) return;
      const body = step.webhookBody
        ? interpolate(step.webhookBody, lead, funnelName)
        : JSON.stringify({ id: lead.id, name: lead.name, phone: lead.phone, email: lead.email, status: lead.status, funnelId: lead.funnelId });
      await fetch(step.webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      }).catch(console.error);
      break;
    }
  }
}

// ── Legacy execution (backward compat) ───────────────────────────────────────

async function executeLegacy(automation: CrmAutomation, lead: Lead) {
  const funnels = getFunnels();
  const funnel = funnels.find((f) => f.id === lead.funnelId);
  const conn = funnel?.connections?.find((c) => c.id === automation.connectionId);
  if (!conn) return;

  if (automation.channel === "uazapi") {
    if (!conn.uazapiToken || !automation.message) return;
    await sendText(conn.uazapiToken, lead.phone, interpolate(automation.message, lead, funnel?.name));
  } else if (automation.channel === "waba") {
    if (!automation.templateId || !conn.metaPhoneNumberId || !conn.metaToken) return;
    const tpl = getTemplates().find((t) => t.id === automation.templateId);
    if (!tpl || tpl.status !== "APPROVED") return;
    const comps = automation.templateVariables
      ? buildMetaComponents(tpl.components, automation.templateVariables, lead, funnel?.name)
      : [];
    await sendTemplate(conn.metaPhoneNumberId, conn.metaToken, lead.phone, tpl.name, tpl.language,
      comps.length > 0 ? comps : undefined);
  }
}

// ── Main runner ───────────────────────────────────────────────────────────────

function scheduleSteps(auto: CrmAutomation, lead: Lead) {
  const allFunnels = getFunnels();
  const funnel = allFunnels.find((f) => f.id === lead.funnelId);
  const funnelName = funnel?.name;

  if (auto.steps && auto.steps.length > 0) {
    // Multi-step: accumulate delays to schedule each non-delay step
    let accMs = 0;
    for (const step of auto.steps) {
      if (step.type === "delay") {
        accMs += (step.delayMinutes ?? 1) * 60 * 1000;
      } else {
        const delay = accMs;
        const s = step;
        const run = () => executeStep(s, lead, allFunnels, funnelName).catch(console.error);
        if (delay > 0) setTimeout(run, delay);
        else run();
      }
    }
  } else {
    // Legacy single-action
    const run = () => executeLegacy(auto, lead).catch(console.error);
    const delay = (auto.delayMinutes ?? 0) * 60 * 1000;
    if (delay > 0) setTimeout(run, delay);
    else run();
  }
}

/**
 * Dispara automações para um evento de CRM.
 */
export function runAutomationsForEvent(
  trigger: CrmTrigger,
  lead: Lead,
  opts?: { toColumnId?: string; webhookId?: string },
) {
  const allForClient = getAutomations(lead.clientId);
  console.log(`[crm-auto] runAutomationsForEvent trigger=${trigger} leadId=${lead.id} phone=${lead.phone} funnelId=${lead.funnelId} toColumnId=${opts?.toColumnId ?? "(none)"} totalAutomations=${allForClient.length}`);
  const all = allForClient.filter((a) => {
    if (!a.active) { console.log(`[crm-auto] skip auto "${a.name}" (${a.id}): inactive`); return false; }
    if (a.trigger !== trigger) { console.log(`[crm-auto] skip auto "${a.name}": trigger mismatch (${a.trigger} != ${trigger})`); return false; }
    if (a.funnelId && a.funnelId !== lead.funnelId) { console.log(`[crm-auto] skip auto "${a.name}": funnelId mismatch (${a.funnelId} != ${lead.funnelId})`); return false; }
    if (trigger === "lead_created" && a.triggerWebhookId && a.triggerWebhookId !== opts?.webhookId) { console.log(`[crm-auto] skip auto "${a.name}": webhookId mismatch`); return false; }
    if (trigger === "column_changed" && a.triggerColumnId && a.triggerColumnId !== opts?.toColumnId) { console.log(`[crm-auto] skip auto "${a.name}": columnId mismatch (${a.triggerColumnId} != ${opts?.toColumnId})`); return false; }
    if (trigger === "column_entered" && a.triggerColumnId && a.triggerColumnId !== opts?.toColumnId) { console.log(`[crm-auto] skip auto "${a.name}": columnId mismatch (${a.triggerColumnId} != ${opts?.toColumnId})`); return false; }
    console.log(`[crm-auto] MATCH auto "${a.name}" (${a.id}) steps=${a.steps?.length ?? 0}`);
    return true;
  });
  console.log(`[crm-auto] matched ${all.length} automation(s) for trigger=${trigger}`);
  for (const auto of all) scheduleSteps(auto, lead);
}

/**
 * Dispara automações scheduled_daily.
 * Chamar via cron endpoint /api/cron/daily.
 * Dispara para todos os leads ativos nas colunas configuradas cujo scheduledTime == hora atual.
 */
export function runScheduledDailyAutomations() {
  const now = new Date();
  const currentTime = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;

  const all = getAutomations().filter((a) => {
    if (!a.active) return false;
    if (a.trigger !== "scheduled_daily") return false;
    if (!a.scheduledTime) return false;
    // Match HH:MM (allow ±1min window)
    const [ah, am] = a.scheduledTime.split(":").map(Number);
    const [ch, cm] = currentTime.split(":").map(Number);
    return ah === ch && Math.abs(am - cm) <= 1;
  });

  for (const auto of all) {
    const leads = getLeads(auto.clientId).filter((l) => {
      if (auto.funnelId && l.funnelId !== auto.funnelId) return false;
      if (auto.triggerColumnId && l.status !== auto.triggerColumnId) return false;
      return true;
    });
    for (const lead of leads) scheduleSteps(auto, lead);
  }
}

