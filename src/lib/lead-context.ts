import { getLeadByPhone,LeadIdentityConflict, type Lead } from "./leads";
import { getFunnels, type Funnel } from "./funnels";
import { getEvolutionSessions } from "./evolution-sessions";

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
