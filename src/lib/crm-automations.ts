import { existsSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import { randomUUID } from "crypto";
import type { Lead } from "./leads";
import { getFunnels } from "./funnels";
import { sendText } from "./uazapi";
import { getTemplates, sendTemplate } from "./waba-templates";

// ── Types ─────────────────────────────────────────────────────────────────────

export type CrmTrigger = "lead_created" | "column_changed";
export type CrmChannel = "uazapi" | "waba";

export type CrmAutomation = {
  id: string;
  clientId: string;
  funnelId?: string;         // se vazio, vale para qualquer funil do cliente
  name: string;
  active: boolean;
  trigger: CrmTrigger;
  triggerColumnId?: string;  // apenas para trigger = "column_changed"
  channel: CrmChannel;
  connectionId: string;      // id da FunnelConnection usada
  // UazapiGO:
  message?: string;          // texto com variáveis {{nome}} {{telefone}} {{email}} {{funil}}
  // Meta WABA:
  templateId?: string;       // id local do WabaTemplate
  delayMinutes: number;      // 0 = imediato
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
  return text
    .replace(/\{\{nome\}\}/gi, lead.name ?? "")
    .replace(/\{\{telefone\}\}/gi, lead.phone ?? "")
    .replace(/\{\{email\}\}/gi, lead.email ?? "")
    .replace(/\{\{funil\}\}/gi, funnelName ?? "");
}

// ── Execution engine ──────────────────────────────────────────────────────────

async function execute(automation: CrmAutomation, lead: Lead) {
  const funnels = getFunnels();
  const funnel = funnels.find((f) => f.id === lead.funnelId);
  const conn = funnel?.connections?.find((c) => c.id === automation.connectionId);
  if (!conn) return;

  if (automation.channel === "uazapi") {
    if (!conn.uazapiToken || !automation.message) return;
    const msg = interpolate(automation.message, lead, funnel?.name);
    await sendText(conn.uazapiToken, lead.phone, msg);

  } else if (automation.channel === "waba") {
    if (!automation.templateId || !conn.metaPhoneNumberId || !conn.metaToken) return;
    const tpl = getTemplates().find((t) => t.id === automation.templateId);
    if (!tpl || tpl.status !== "APPROVED") return;
    await sendTemplate(
      conn.metaPhoneNumberId,
      conn.metaToken,
      lead.phone,
      tpl.name,
      tpl.language,
    );
  }
}

/**
 * Dispara automações para um evento de CRM.
 * Chame este método nos pontos de trigger (webhook, kanban).
 */
export function runAutomationsForEvent(
  trigger: CrmTrigger,
  lead: Lead,
  opts?: { toColumnId?: string },
) {
  // Fire-and-forget: não bloqueia a resposta
  const all = getAutomations(lead.clientId).filter((a) => {
    if (!a.active) return false;
    if (a.trigger !== trigger) return false;
    if (a.funnelId && a.funnelId !== lead.funnelId) return false;
    if (trigger === "column_changed" && a.triggerColumnId && a.triggerColumnId !== opts?.toColumnId) return false;
    return true;
  });

  for (const auto of all) {
    const run = () => execute(auto, lead).catch(console.error);
    if (auto.delayMinutes > 0) {
      setTimeout(run, auto.delayMinutes * 60 * 1000);
    } else {
      run();
    }
  }
}
