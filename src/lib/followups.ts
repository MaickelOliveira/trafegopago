import { readRecordList, writeRecordList, type RecordFilter } from "./record-store";
import { withDataTransaction } from "./document-store";
import { randomUUID } from "node:crypto";
import { normalizePhone,LeadIdentityConflict } from "./leads";
import type { Lead } from "./leads";
import { getLeadForConnection } from "./lead-context";
import { getAgentConfigForConnection, getClientById } from "./clients";
import { isAgentPhoneIgnored } from "./agent-phone-policy";
import { followUpWeeklyLimit, nextAllowedFollowUpTime } from "./followup-policy";
import { getHistory } from "./conversations";
import { getFunnelById } from "./funnels";

export type FollowUpType = "followup" | "reminder" | "appointment_reminder";
export type FollowUpStatus = "pending" | "processing" | "sent" | "cancelled" | "failed";
export type FollowUp = {
  id: string; clientId: string; phone: string; scheduledAt: string; message: string;
  type: FollowUpType; status: FollowUpStatus; createdAt: string;
  stepIndex?: number; stepId?: string; appointmentEventId?: string;
  messageType?: "text" | "ai" | "template"; templateId?: string;
  templateVariables?: Record<string, string>; connId?: string;
  lastError?: string; wamid?: string; leadId?: string; funnelId?: string;
  processingAt?: string; sentAt?: string;
  cycleId?: string; cancelledAt?: string;
  cancelReason?: "customer_replied" | "human_takeover" | "new_company_reply" | "lead_closed" | "configuration_disabled" | "frequency_limit" | "manual" | "context_rejected";
};
type Step = { id: string; delayHours: number; message: string; messageType?: string; templateId?: string; templateVariables?: Record<string, string> };
const load = (filter?: RecordFilter, options?: Parameters<typeof readRecordList>[2]) => readRecordList<FollowUp>("followups.json", filter, options);
const save = (items: FollowUp[]) => writeRecordList("followups.json", items);
const samePhone = (a: string, b: string) => normalizePhone(a) === normalizePhone(b);

export async function scheduleFollowUp(data: Omit<FollowUp, "id" | "status" | "createdAt">): Promise<FollowUp> {
  if (!Number.isFinite(Date.parse(data.scheduledAt))) throw new Error("Data do acompanhamento inválida.");
  return withDataTransaction(async () => {
    const items = await load({ clientId: data.clientId, phone: data.phone, connId: data.connId ?? null, status: ["pending", "processing"] });
    const existing = items.find(item => item.clientId === data.clientId && samePhone(item.phone, data.phone) &&
      item.connId === data.connId && item.type === data.type &&
      (data.type === "reminder" && !data.stepId && !data.appointmentEventId
        ? item.message === data.message && Math.abs(Date.parse(item.scheduledAt) - Date.parse(data.scheduledAt)) < 60_000
        : item.stepId === data.stepId && item.appointmentEventId === data.appointmentEventId && item.cycleId === data.cycleId) &&
      ["pending", "processing"].includes(item.status));
    if (existing) return existing;
    const item: FollowUp = { ...data, phone: normalizePhone(data.phone), id: randomUUID(), status: "pending", createdAt: new Date().toISOString() };
    items.push(item);
    await save(items);
    return item;
  });
}

export async function getDueFollowUps(): Promise<FollowUp[]> {
  return (await load({ status: "pending" }, { before: { field: "scheduledAt", value: new Date().toISOString() }, limit: 20 })).filter(item => item.status === "pending" && Date.parse(item.scheduledAt) <= Date.now());
}

/** Claim is committed before any network call; shared by the internal and HTTP scheduler. */
export async function claimDueFollowUps(): Promise<FollowUp[]> {
  return withDataTransaction(async () => {
    const now = Date.now();
    const items = await load({ status: ["pending", "processing"] });
    let changed = false;
    for (const item of items) {
      if (item.status === "processing" && now - Date.parse(item.processingAt || item.scheduledAt) > 30 * 60_000) {
        item.status = "failed";
        item.lastError = "Processamento interrompido. Confira a entrega antes de reenviar.";
        changed = true;
      }
    }
    const due = items.filter(item => item.status === "pending" && Date.parse(item.scheduledAt) <= now)
      .sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt)).slice(0, 20);
    for (const item of due) { item.status = "processing"; item.processingAt = new Date(now).toISOString(); }
    if (changed || due.length) await save(items);
    return structuredClone(due);
  });
}

export async function getPendingFollowUps(clientId?: string): Promise<FollowUp[]> {
  return (await load({ ...(clientId ? { clientId } : {}), status: "pending" })).filter(item => item.status === "pending" && (!clientId || item.clientId === clientId));
}
export async function getAllFollowUps(clientId?: string): Promise<FollowUp[]> {
  return (await load(clientId ? { clientId } : {})).filter(item => !clientId || item.clientId === clientId);
}
export async function getFollowUpById(id: string): Promise<FollowUp | undefined> {
  return (await load({ id })).find(item => item.id === id);
}
export async function getFollowUpByWamid(wamid: string): Promise<FollowUp | undefined> {
  return (await load({ wamid })).find(item => item.wamid === wamid);
}
async function patchItem(id: string, patch: Partial<FollowUp>): Promise<void> {
  await withDataTransaction(async () => {
    const items = await load({ id });
    const item = items.find(item => item.id === id);
    if (!item) return;
    Object.assign(item, patch);
    await save(items);
  });
}
export async function markSent(id: string, wamid?: string): Promise<void> {
  await patchItem(id, { status: "sent", sentAt: new Date().toISOString(), ...(wamid ? { wamid } : {}) });
}
export async function markFailed(id: string, error: string): Promise<void> {
  await patchItem(id, { status: "failed", lastError: error.slice(0, 500) });
}
export async function cancelFollowUp(id: string, reason: FollowUp["cancelReason"] = "manual"): Promise<void> {
  await patchItem(id, { status: "cancelled", cancelledAt: new Date().toISOString(), cancelReason: reason });
}

export async function rescheduleFollowUp(id: string, scheduledAt: string): Promise<void> {
  await patchItem(id, { status: "pending", scheduledAt, processingAt: undefined });
}

export async function sentFollowUpsInLast7Days(clientId: string, phone: string, connId?: string): Promise<number> {
  const since = Date.now() - 7 * 24 * 3600_000;
  return (await load({ clientId, phone, connId: connId ?? null, status: "sent", type: "followup" }))
    .filter(item => item.type === "followup" && item.clientId === clientId && item.connId === connId && samePhone(item.phone, phone) &&
      item.sentAt && Date.parse(item.sentAt) >= since).length;
}

/** Começa um novo ciclo somente após uma resposta efetivamente enviada pela empresa. */
export async function startFollowUpSequence(clientId: string, phone: string, steps: Step[], connId?: string): Promise<void> {
  if (!steps.length) return;
  if (steps.length > 2 || steps.some(step => !step.id || !Number.isFinite(step.delayHours) || step.delayHours < 0 || step.delayHours > 8760)) throw new Error("A sequência permite até duas tentativas com intervalos válidos.");
  await withDataTransaction(async () => {
    let lead;
    try{lead=await getLeadForConnection(clientId,phone,connId);}catch(error){if(!(error instanceof LeadIdentityConflict))throw error;await cancelFollowUpsForPhone(clientId,phone,connId,"lead_closed");return;}
    const client = await getClientById(clientId);
    const config = client ? getAgentConfigForConnection(client, connId) : undefined;
    if (!lead || !config?.followUpEnabled || lead.followUpDisabled || lead.aiPaused || ["ganho", "perdido"].includes(lead.status) || isAgentPhoneIgnored(config, phone, lead.realPhone)) {
      await cancelFollowUpsForPhone(clientId, phone, connId, "lead_closed");
      return;
    }
    const column = (await getFunnelById(lead.funnelId))?.columns.find(item => item.id === lead.status);
    if (column?.blockFollowUps) {
      await cancelFollowUpsForPhone(clientId, phone, connId, "lead_closed", "followup");
      return;
    }
    // A resposta pode chegar enquanto o provedor confirma os pedaços da resposta
    // da IA. Nesse caso, o webhook já encerrou o ciclo e não podemos recriá-lo.
    if ((await getHistory(phone, clientId, connId)).at(-1)?.role === "user") {
      await cancelFollowUpsForPhone(clientId, phone, connId, "customer_replied", "followup");
      return;
    }
    await cancelFollowUpsForPhone(clientId, phone, connId, "new_company_reply", "followup");
    const step = steps[0];
    const scheduledAt = nextAllowedFollowUpTime(Date.now() + step.delayHours * 3_600_000, config);
    const scheduled = await scheduleFollowUp({ clientId, phone, connId, leadId: lead.id, funnelId: lead.funnelId,
      scheduledAt: new Date(scheduledAt).toISOString(), message: step.message,
      type: "followup", cycleId: randomUUID(), stepIndex: 0, stepId: step.id,
      messageType: step.messageType as FollowUp["messageType"], templateId: step.templateId, templateVariables: step.templateVariables });
    if (await sentFollowUpsInLast7Days(clientId, phone, connId) >= followUpWeeklyLimit(config)) {
      await cancelFollowUp(scheduled.id, "frequency_limit");
    }
  });
}
export async function cancelFollowUpsForPhone(clientId: string, phone: string, connId?: string | null, reason: FollowUp["cancelReason"] = "manual", onlyType?: FollowUpType): Promise<void> {
  await withDataTransaction(async () => {
    const items = await load({ clientId, phone, ...(connId === undefined ? {} : { connId }), ...(onlyType ? { type: onlyType } : {}), status: ["pending", "processing"] }); let changed = false;
    for (const item of items) {
      if (item.clientId === clientId && samePhone(item.phone, phone) && (connId === undefined || (item.connId ?? null) === connId) && (!onlyType || item.type === onlyType) && ["pending", "processing"].includes(item.status)) {
        item.status = "cancelled"; item.cancelledAt = new Date().toISOString(); item.cancelReason = reason; changed = true;
      }
    }
    if (changed) await save(items);
  });
}
export async function getActiveFollowUpsForLead(lead: Lead): Promise<FollowUp[]> {
  const rows=await load({clientId:lead.clientId,status:["pending","processing"]}),result:FollowUp[]=[];
  const resolved=new Map<string,Promise<Lead|undefined>>();
  for(const item of rows) {
    if(item.clientId!==lead.clientId||!["pending","processing"].includes(item.status)||![lead.phone,lead.realPhone].some(phone=>phone&&samePhone(item.phone,phone)))continue;
    if(item.leadId){if(item.leadId===lead.id)result.push(item);continue;}
    if(item.funnelId){if(item.funnelId===lead.funnelId)result.push(item);continue;}
    const key=`${item.connId??""}:${normalizePhone(item.phone)}`;
    if(!resolved.has(key))resolved.set(key,getLeadForConnection(lead.clientId,item.phone,item.connId));
    if((await resolved.get(key))?.id===lead.id)result.push(item);
  }
  return result;
}

/** Últimos eventos do mesmo lead, inclusive cancelamentos, para explicar por que um agendamento saiu da lista. */
export async function getRecentFollowUpsForLead(lead: Lead, limit = 5): Promise<FollowUp[]> {
  const phones = [...new Set([lead.phone, lead.realPhone].filter((value): value is string => !!value))];
  const groups = await Promise.all(phones.map(phone => load({ clientId: lead.clientId, phone })));
  const unique = new Map(groups.flat().map(item => [item.id, item]));
  return [...unique.values()].filter(item => {
    if (item.clientId !== lead.clientId || ![lead.phone, lead.realPhone].some(phone => phone && samePhone(item.phone, phone))) return false;
    if (item.leadId) return item.leadId === lead.id;
    if (item.funnelId) return item.funnelId === lead.funnelId;
    return false; // Item legado sem vínculo não pode aparecer no funil errado.
  }).sort((a, b) => Date.parse(b.cancelledAt || b.sentAt || b.scheduledAt) - Date.parse(a.cancelledAt || a.sentAt || a.scheduledAt)).slice(0, limit);
}
export async function cancelFollowUpsForConnection(clientId: string, connId?: string | null, reason: FollowUp["cancelReason"] = "configuration_disabled"): Promise<void> {
  await withDataTransaction(async () => {
    const items = await load({ clientId, connId: connId ?? null, status: ["pending", "processing"] }); let changed = false;
    for (const item of items) {
      if (item.clientId === clientId && (item.connId ?? null) === (connId ?? null) && ["pending", "processing"].includes(item.status)) {
        item.status = "cancelled"; item.cancelledAt = new Date().toISOString(); item.cancelReason = reason; changed = true;
      }
    }
    if (changed) await save(items);
  });
}
