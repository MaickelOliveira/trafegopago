import { getAllConversationsByClientId, phoneVariants } from "./conversations";
import { getFunnels } from "./funnels";
import { getFunnelForConnection } from "./lead-context";
import { getEvolutionSessions } from "./evolution-sessions";
export async function resolveConversationChannel(clientId: string, phone: string, funnelId?: string, requested?: string): Promise<string | undefined> {
  if (requested) { const funnel = await getFunnelForConnection(clientId, requested); return funnel && (!funnelId || funnel.id === funnelId) ? requested : undefined; }
  const funnels = (await getFunnels()).filter(funnel => funnel.clientId === clientId && (!funnelId || funnel.id === funnelId));
  const owned = new Set(funnels.map(funnel => funnel.id));
  const sessions = await getEvolutionSessions();
  const ids = [...new Set([...funnels.flatMap(funnel => (funnel.connections ?? []).filter(connection=>connection.type==="meta").map(connection => connection.id)), ...sessions.filter(session => session.funnelId && owned.has(session.funnelId)).map(session => session.id)])];
  const variants = new Set(phoneVariants(phone));
  const withHistory = new Set((await getAllConversationsByClientId(clientId)).filter(conversation => conversation.connId && ids.includes(conversation.connId) && variants.has(conversation.phone)).map(conversation => conversation.connId!));
  if (withHistory.size === 1) return [...withHistory][0];
  return !withHistory.size && ids.length === 1 ? ids[0] : undefined;
}
