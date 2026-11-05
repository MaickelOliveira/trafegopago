import type { Lead } from "./leads";
import { normalizePhone, getLeads } from "./leads";
import { getFunnelById } from "./funnels";
import { getEvolutionSessions } from "./evolution-sessions";
import { getAllFollowUps, cancelFollowUp } from "./followups";
import { setAiPaused } from "./conversations";

export async function synchronizeLeadWorkflows(lead: Lead, previous?: Lead): Promise<void> {
  const funnel = await getFunnelById(lead.funnelId);
  const sessions = await getEvolutionSessions();
  const connectionIds = new Set([
    ...(funnel?.connections ?? []).map(connection => connection.id),
    ...sessions.filter(session => session.funnelId === lead.funnelId && (!("clientId" in session) || !session.clientId || session.clientId === lead.clientId)).map(session => session.id),
  ]);
  if (typeof lead.aiPaused === "boolean" && lead.aiPaused !== previous?.aiPaused) {
    for (const connectionId of connectionIds) await setAiPaused(lead.phone, lead.aiPaused, lead.clientId, connectionId);
  }
  const column = funnel?.columns.find(column => column.id === lead.status);
  if (!lead.followUpDisabled && !["ganho", "perdido"].includes(lead.status) && !column?.blockFollowUps) return;
  const phone = normalizePhone(lead.phone);
  const matchingLeads = (await getLeads(lead.clientId)).filter(item => normalizePhone(item.phone) === phone);
  for (const item of await getAllFollowUps(lead.clientId)) {
    if (!["pending", "processing"].includes(item.status) || normalizePhone(item.phone) !== phone) continue;
    const belongs = item.leadId ? item.leadId === lead.id : item.funnelId ? item.funnelId === lead.funnelId : item.connId ? connectionIds.has(item.connId) : matchingLeads.length === 1;
    if (belongs) await cancelFollowUp(item.id);
  }
}
