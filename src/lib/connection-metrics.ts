import { getFunnels } from "./funnels";
import { getClients } from "./clients";
import { getEvolutionSessions } from "./evolution-sessions";
import { checkConnectionStatus as checkEvolutionConnectionStatus,getInstancePhone } from "./evolution-api";
import { getAllConversationsByClientId,getHistory,phoneVariants } from "./conversations";
import { getLeads } from "./leads";
export type LiveConnection={id:string;phone:string;type:"meta"|"evolution";status:string;connected:boolean;funnelId:string;funnelName:string;qr?:string|null};
export type ConnectionMetrics = LiveConnection & {
  conversationCount: number;
  messageCount: number;
  leadsTotal: number;
  leadsNeedingHuman: number;
  resolutionRate: number | null; // 0-1, null quando leadsTotal === 0
};

const WINDOW_MS_DEFAULT = 7 * 24 * 60 * 60 * 1000;

export async function getLiveConnectionsForClient(clientId:string):Promise<LiveConnection[]> {
 const funnels=(await getFunnels()).filter(funnel=>funnel.clientId===clientId);
 const results:Promise<LiveConnection>[]=[];
 for(const funnel of funnels)for(const connection of funnel.connections??[]){
  if(connection.type!=="meta")continue;
  results.push((async()=>{
   let status="not_configured",phone=connection.phone||connection.metaPhoneNumberId||"";
   if(connection.metaPhoneNumberId&&connection.metaToken)try{
    const response=await fetch(`https://graph.facebook.com/v26.0/${connection.metaPhoneNumberId}?fields=display_phone_number`,{headers:{Authorization:`Bearer ${connection.metaToken}`},signal:AbortSignal.timeout(5000),cache:"no-store"});
    if(response.ok){const data=await response.json();phone=data.display_phone_number||phone;status="connected";}else status="error";
   }catch{status="unknown";}
   return {id:connection.id,phone,type:"meta",status,connected:status==="connected",funnelId:funnel.id,funnelName:funnel.name};
  })());
 }
 for(const session of await getEvolutionSessions()){
  const funnel=funnels.find(item=>item.id===session.funnelId);
  if(!funnel||(session.clientId&&session.clientId!==clientId))continue;
  results.push((async()=>{const status=await checkEvolutionConnectionStatus(session.instanceName);return{id:session.id,phone:(await getInstancePhone(session.instanceName).catch(()=>null))||session.instanceName,type:"evolution",status,connected:status==="CONNECTED",funnelId:funnel.id,funnelName:funnel.name};})());
 }
 return Promise.all(results);
}

/** Métricas de atendimento por conexão: volume (conversas/mensagens na janela) e
 *  taxa de resolução da IA (foto do momento atual — não é histórico). */
export async function getConnectionMetricsForClient(
  clientId: string,
  windowMs: number = WINDOW_MS_DEFAULT
): Promise<ConnectionMetrics[]> {
  const [connections, conversations, leads] = [
    await getLiveConnectionsForClient(clientId),
    (await getAllConversationsByClientId(clientId)),
    (await getLeads(clientId)),
  ];

  const since = Date.now() - windowMs;

  return Promise.all(connections.map(async (conn) => {
    const convsForConn = conversations.filter((c) => c.connId === conn.id);
    const recentConvs = convsForConn.filter((c) => c.lastActivity >= since);

    let messageCount = 0;
    for (const conversation of recentConvs) {
      const history = await getHistory(conversation.phone, clientId, conn.id);
      messageCount += history.filter((message) => message.ts >= since).length;
    }

    // Junta leads a esta conexão pelo telefone (best-effort — Lead não guarda connId)
    const convPhoneSet = new Set(convsForConn.map((c) => c.phone));
    const leadsForConn = leads.filter((l) => l.funnelId === conn.funnelId &&
      phoneVariants(l.realPhone ?? l.phone).some((v) => convPhoneSet.has(v))
    );
    const leadsNeedingHuman = leadsForConn.filter((l) => l.needsAttention || l.aiPaused).length;

    return {
      ...conn,
      conversationCount: recentConvs.length,
      messageCount,
      leadsTotal: leadsForConn.length,
      leadsNeedingHuman,
      resolutionRate: leadsForConn.length > 0 ? (leadsForConn.length - leadsNeedingHuman) / leadsForConn.length : null,
    };
  }));
}

export async function getConnectionMetricsForAllClients(
  windowMs?: number
): Promise<Array<{ clientId: string; clientName: string; connections: ConnectionMetrics[] }>> {
  const clients = (await getClients());
  const results = await Promise.all(
    (await Promise.all(clients.map(async (c) => ({
      clientId: c.id,
      clientName: c.name,
      connections: await getConnectionMetricsForClient(c.id, windowMs),
    }))))
  );
  return results;
}

let _allClientsCache: { data: Awaited<ReturnType<typeof getConnectionMetricsForAllClients>>; ts: number } | null = null;
const ALL_CLIENTS_TTL_MS = 45_000;

/** Cache em memória (TTL curto) só pra visão geral do gestor — evita repetir
 *  pings externos (UazAPI/WPPConnect) de todos os clientes em todo reload. */
export async function getCachedAllClientsMetrics() {
  if (_allClientsCache && Date.now() - _allClientsCache.ts < ALL_CLIENTS_TTL_MS) {
    return _allClientsCache.data;
  }
  const data = await getConnectionMetricsForAllClients();
  _allClientsCache = { data, ts: Date.now() };
  return data;
}
