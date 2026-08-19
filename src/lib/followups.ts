import { readFileSync, writeFileSync, existsSync } from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { getLeadByPhone } from "./leads";

export type FollowUpType = "followup" | "reminder" | "appointment_reminder";
export type FollowUpStatus = "pending" | "processing" | "sent" | "cancelled" | "failed";

export type FollowUp = {
  id: string;
  clientId: string;
  phone: string;
  scheduledAt: string; // ISO timestamp
  message: string;
  type: FollowUpType;
  status: FollowUpStatus;
  stepIndex?: number;           // índice do step na sequência (0, 1, 2...)
  stepId?: string;              // id do FollowUpStep configurado
  appointmentEventId?: string;  // Google Calendar event ID (para appointment_reminder)
  createdAt: string;
  messageType?: "text" | "ai" | "template"; // tipo de envio
  templateId?: string;                       // id do template Meta
  templateVariables?: Record<string, string>; // variáveis do template
  connId?: string;              // conexão/número de origem da conversa — garante que o
                                 // follow-up seja enviado pelo MESMO canal (WPPConnect,
                                 // UazAPI ou Meta) que o lead conversou, não outro
  lastError?: string;            // motivo do envio ter falhado (status "failed")
  wamid?: string;                // id da mensagem na Meta — usado para casar com o
                                  // status assíncrono (sent/delivered/read/failed) do webhook
};

const FILE = path.join(process.cwd(), "data", "followups.json");

function load(): FollowUp[] {
  try {
    if (!existsSync(FILE)) return [];
    return JSON.parse(readFileSync(FILE, "utf-8"));
  } catch {
    return [];
  }
}

function save(items: FollowUp[]) {
  writeFileSync(FILE, JSON.stringify(items, null, 2));
}

export function scheduleFollowUp(
  data: Omit<FollowUp, "id" | "status" | "createdAt">
): FollowUp {
  const items = load();
  const item: FollowUp = {
    ...data,
    id: randomUUID(),
    status: "pending",
    createdAt: new Date().toISOString(),
  };
  items.push(item);
  save(items);
  return item;
}

export function getDueFollowUps(): FollowUp[] {
  const now = new Date();
  return load().filter(
    (f) => f.status === "pending" && new Date(f.scheduledAt) <= now
  );
}

/** Reivindica follow-ups vencidos atomicamente: lê + marca como "processing"
 *  em um único writeFileSync, evitando que dois crons concorrentes processem
 *  o mesmo item. Retorna apenas os itens que esta chamada reivindicou. */
export function claimDueFollowUps(): FollowUp[] {
  const now = new Date();
  const items = load();
  const claimed: FollowUp[] = [];
  for (const f of items) {
    if (f.status === "pending" && new Date(f.scheduledAt) <= now) {
      f.status = "processing";
      claimed.push({ ...f });
    }
  }
  if (claimed.length > 0) save(items);
  return claimed;
}

export function getPendingFollowUps(clientId?: string): FollowUp[] {
  return load().filter(
    (f) => f.status === "pending" && (!clientId || f.clientId === clientId)
  );
}

export function getAllFollowUps(clientId?: string): FollowUp[] {
  return load().filter((f) => !clientId || f.clientId === clientId);
}

export function markSent(id: string, wamid?: string): void {
  const items = load();
  const idx = items.findIndex((f) => f.id === id);
  if (idx >= 0) {
    items[idx].status = "sent";
    if (wamid) items[idx].wamid = wamid;
    save(items);
  }
}

export function getFollowUpByWamid(wamid: string): FollowUp | undefined {
  return load().find((f) => f.wamid === wamid);
}

export function markFailed(id: string, error: string): void {
  const items = load();
  const idx = items.findIndex((f) => f.id === id);
  if (idx >= 0) {
    items[idx].status = "failed";
    items[idx].lastError = error;
    save(items);
  }
}

export function cancelFollowUp(id: string): void {
  const items = load();
  const idx = items.findIndex((f) => f.id === id);
  if (idx >= 0) {
    items[idx].status = "cancelled";
    save(items);
  }
}

// Inicia a sequência de follow-ups para um lead (step 0)
export function startFollowUpSequence(
  clientId: string,
  phone: string,
  steps: { id: string; delayHours: number; message: string; messageType?: string; templateId?: string; templateVariables?: Record<string, string> }[],
  connId?: string
): void {
  if (steps.length === 0) return;
  // Checagem central — vale pra todos os pontos de entrada (webhooks de todos
  // os providers), sem precisar duplicar o check em cada um.
  const lead = getLeadByPhone(clientId, phone);
  if (lead?.followUpDisabled) {
    console.log(`[followups] follow-up desativado pra esse lead — clientId=${clientId} phone=${phone}`);
    return;
  }
  const first = steps[0];
  const scheduledAt = new Date(Date.now() + first.delayHours * 3600000).toISOString();
  scheduleFollowUp({
    clientId,
    phone,
    scheduledAt,
    message: first.message,
    type: "followup",
    connId,
    stepIndex: 0,
    stepId: first.id,
    messageType: first.messageType as "text" | "ai" | "template" | undefined,
    templateId: first.templateId,
    templateVariables: first.templateVariables,
  });
}

/**
 * Reinicia a "espera" de follow-up quando o lead volta a interagir (responde,
 * ou o operador assume o atendimento), mas RETOMA do step em que a sequência
 * já estava — nunca reseta pro step 0.
 *
 * Antes, todo ponto de entrada (webhooks WPPConnect/Evolution/UazAPI/Meta)
 * fazia cancelFollowUpsForPhone + startFollowUpSequence, que sempre recomeça
 * do step 0. Na prática isso quebrava a sequência inteira: se o lead
 * respondesse qualquer coisa entre o step 0 (enviado) e o step 1 (ainda
 * pendente), o step 1 era cancelado e um NOVO step 0 era agendado do zero —
 * o step 1, 2, 3... programados nunca chegavam a ser enviados, só o
 * primeiro (relatado pelo usuário: "meu followup está fazendo somente um e
 * não os programados").
 */
export function restartFollowUpSequence(
  clientId: string,
  phone: string,
  steps: { id: string; delayHours: number; message: string; messageType?: string; templateId?: string; templateVariables?: Record<string, string> }[],
  connId?: string
): void {
  if (steps.length === 0) return;
  const lead = getLeadByPhone(clientId, phone);
  if (lead?.followUpDisabled) {
    console.log(`[followups] follow-up desativado pra esse lead — clientId=${clientId} phone=${phone}`);
    return;
  }

  const pending = load().filter(
    (f) => f.clientId === clientId && f.phone === phone && f.status === "pending"
  );
  const resumeIdx = pending.length > 0
    ? Math.min(Math.max(...pending.map((f) => f.stepIndex ?? 0)), steps.length - 1)
    : 0;

  cancelFollowUpsForPhone(clientId, phone);

  const step = steps[resumeIdx];
  const scheduledAt = new Date(Date.now() + step.delayHours * 3600000).toISOString();
  scheduleFollowUp({
    clientId,
    phone,
    scheduledAt,
    message: step.message,
    type: "followup",
    connId,
    stepIndex: resumeIdx,
    stepId: step.id,
    messageType: step.messageType as "text" | "ai" | "template" | undefined,
    templateId: step.templateId,
    templateVariables: step.templateVariables,
  });
}

export function cancelFollowUpsForPhone(clientId: string, phone: string): void {
  const items = load();
  let changed = false;
  for (const item of items) {
    if (item.clientId === clientId && item.phone === phone && (item.status === "pending" || item.status === "processing")) {
      item.status = "cancelled";
      changed = true;
    }
  }
  if (changed) save(items);
}

/** Cancela TODOS os follow-ups pendentes de uma conexão inteira (todos os
 *  leads), não só de um telefone — usado quando o gestor desativa
 *  followUpEnabled ou apaga a lista de passos configurados. Sem isso, itens
 *  já agendados ANTES da mudança continuavam na fila e disparavam mesmo
 *  com a config atual dizendo que não deveriam mais (relatado: desativa o
 *  toggle, ou apaga os passos, e o follow-up chega pro lead assim mesmo). */
export function cancelFollowUpsForConnection(clientId: string, connId?: string | null): void {
  const items = load();
  let changed = false;
  for (const item of items) {
    if (item.clientId !== clientId) continue;
    if (connId ? item.connId !== connId : !!item.connId) continue;
    if (item.status === "pending" || item.status === "processing") {
      item.status = "cancelled";
      changed = true;
    }
  }
  if (changed) save(items);
}
