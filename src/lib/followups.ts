import { readRecordList, writeRecordList, type RecordFilter } from "./record-store";
import { withDataTransaction } from "./document-store";
import { randomUUID } from "node:crypto";
import { normalizePhone,LeadIdentityConflict } from "./leads";
import type { Lead } from "./leads";
import { getLeadForConnection } from "./lead-context";
import { getAgentConfigForConnection, getClientById } from "./clients";
import { isAgentPhoneIgnored } from "./agent-phone-policy";

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
      item.connId === data.connId && item.type === data.type && item.stepId === data.stepId &&
      item.appointmentEventId === data.appointmentEventId && ["pending", "processing"].includes(item.status));
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
export async function cancelFollowUp(id: string): Promise<void> {
  await patchItem(id, { status: "cancelled" });
}

async function queueSequence(clientId: string, phone: string, steps: Step[], connId: string | undefined, restart: boolean): Promise<void> {
  if (!steps.length) return;
  if (steps.some(step => !step.id || !Number.isFinite(step.delayHours) || step.delayHours < 0 || step.delayHours > 8760)) throw new Error("Intervalo de acompanhamento inválido.");
  await withDataTransaction(async () => {
    let lead;
    try{lead=await getLeadForConnection(clientId,phone,connId);}catch(error){if(!(error instanceof LeadIdentityConflict))throw error;await cancelFollowUpsForPhone(clientId,phone,connId);return;}
    const client = await getClientById(clientId);
    const config = client ? getAgentConfigForConnection(client, connId) : undefined;
    if (!lead || !config?.followUpEnabled || lead.followUpDisabled || ["ganho", "perdido"].includes(lead.status) || isAgentPhoneIgnored(config, phone, lead.realPhone)) {
      await cancelFollowUpsForPhone(clientId, phone, connId);
      return;
    }
    const items = await load({ clientId, phone, connId: connId ?? null, type: "followup" });
    const sequence = items.filter(item => item.type === "followup" && item.clientId === clientId && samePhone(item.phone, phone) && item.connId === connId);
    const active = sequence.filter(item => ["pending", "processing"].includes(item.status));
    if (!restart && active.length) return;
    const sentIndices = sequence.filter(item => item.status === "sent").map(item => steps.findIndex(step => step.id === item.stepId));
    const sentNext = sentIndices.length ? Math.max(...sentIndices) + 1 : 0;
    const pendingIndices = active.map(item => steps.findIndex(step => step.id === item.stepId)).filter(index => index >= 0);
    const index = pendingIndices.length ? Math.max(sentNext, Math.min(...pendingIndices)) : sentNext;
    if (index >= steps.length) return; // a completed sequence never restarts itself
    for (const item of active) item.status = "cancelled";
    await save(items);
    const step = steps[index];
    await scheduleFollowUp({ clientId, phone, connId, leadId: lead.id, funnelId: lead.funnelId,
      scheduledAt: new Date(Date.now() + step.delayHours * 3_600_000).toISOString(), message: step.message,
      type: "followup", stepIndex: index, stepId: step.id,
      messageType: step.messageType as FollowUp["messageType"], templateId: step.templateId, templateVariables: step.templateVariables });
  });
}
export async function startFollowUpSequence(clientId: string, phone: string, steps: Step[], connId?: string): Promise<void> {
  await queueSequence(clientId, phone, steps, connId, false);
}
export async function restartFollowUpSequence(clientId: string, phone: string, steps: Step[], connId?: string): Promise<void> {
  await queueSequence(clientId, phone, steps, connId, true);
}
export async function cancelFollowUpsForPhone(clientId: string, phone: string, connId?: string | null): Promise<void> {
  await withDataTransaction(async () => {
    const items = await load({ clientId, phone, ...(connId === undefined ? {} : { connId }), status: ["pending", "processing"] }); let changed = false;
    for (const item of items) {
      if (item.clientId === clientId && samePhone(item.phone, phone) && (connId === undefined || (item.connId ?? null) === connId) && ["pending", "processing"].includes(item.status)) {
        item.status = "cancelled"; changed = true;
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
export async function cancelFollowUpsForConnection(clientId: string, connId?: string | null): Promise<void> {
  await withDataTransaction(async () => {
    const items = await load({ clientId, connId: connId ?? null, status: ["pending", "processing"] }); let changed = false;
    for (const item of items) {
      if (item.clientId === clientId && (item.connId ?? null) === (connId ?? null) && ["pending", "processing"].includes(item.status)) {
        item.status = "cancelled"; changed = true;
      }
    }
    if (changed) await save(items);
  });
}
