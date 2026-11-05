import { getLeadByPhone,LeadIdentityConflict, type Lead } from "./leads";
import { getFunnels, getFunnelById, type Funnel } from "./funnels";
import { getEvolutionSessions, type EvolutionSession } from "./evolution-sessions";
import { setAiPaused } from "./conversations";

export async function getFunnelForConnection(clientId: string, connectionId: string): Promise<Funnel | undefined> {
  const funnels = (await getFunnels()).filter(funnel => funnel.clientId === clientId);
  const direct = funnels.filter(funnel => funnel.connections?.some(connection => connection.type === "meta" && connection.id === connectionId));
  if (direct.length === 1) return direct[0];
  if (direct.length > 1) return undefined;
  const sessions = await getEvolutionSessions();
  const session = sessions.find(item => item.id === connectionId);
  if (!session || ("clientId" in session && session.clientId && session.clientId !== clientId)) return undefined;
  return funnels.find(funnel => funnel.id === session.funnelId);
}

/** Never choose the first matching telephone across multiple funnels. */
export async function getLeadForConnection(clientId: string, phone: string, connectionId?: string | null): Promise<Lead | undefined> {
  const funnel = connectionId ? await getFunnelForConnection(clientId, connectionId) : undefined;
  if (connectionId && !funnel) return undefined;
  return getLeadByPhone(clientId,phone,funnel?.id);
}

/** Ambiguous CRM identities cannot block delivery on their original chat channel. */
export async function getChatLeadForConnection(clientId:string,phone:string,connectionId?:string|null):Promise<Lead|undefined>{
 try{return await getLeadForConnection(clientId,phone,connectionId);}catch(error){if(error instanceof LeadIdentityConflict)return undefined;throw error;}
}

/** Keep the chat pause flags in step with a lead's CRM pause control. */
export async function syncLeadAiPause(
  lead: Pick<Lead, "clientId" | "funnelId" | "phone">,
  paused: boolean,
  sessions?: EvolutionSession[],
): Promise<void> {
  const funnel = await getFunnelById(lead.funnelId);
  if (!funnel || (funnel.clientId && funnel.clientId !== lead.clientId)) return;

  const activeSessions = sessions ?? await getEvolutionSessions();
  const connectionIds = new Set<string>([
    ...(funnel.connections ?? []).filter(connection => connection.type === "meta").map(connection => connection.id),
    ...activeSessions
      .filter(session => session.funnelId === lead.funnelId && (!session.clientId || session.clientId === lead.clientId))
      .map(session => session.id),
  ]);
  for (const connectionId of connectionIds) {
    await setAiPaused(lead.phone, paused, lead.clientId, connectionId);
  }
}
