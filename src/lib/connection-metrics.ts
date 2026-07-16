// Camada de métricas de atendimento da IA por conexão (número de WhatsApp).
// Status ao vivo extraído de connection-status/route.ts (mesmo comportamento,
// só que paralelizado) — usado tanto pela rota do cliente quanto do gestor.
import { getFunnels } from "@/lib/funnels";
import { getClients } from "@/lib/clients";
import { getWppSessions } from "@/lib/wppconnect-sessions";
import { getEvolutionSessions } from "@/lib/evolution-sessions";
import { getInstanceStatus } from "@/lib/uazapi";
import { checkConnectionStatus } from "@/lib/wppconnect-api";
import { checkConnectionStatus as checkEvolutionConnectionStatus, getInstancePhone } from "@/lib/evolution-api";
import { getAllConversationsByClientId, getHistory, phoneVariants } from "@/lib/conversations";
import { getLeads } from "@/lib/leads";

export type LiveConnection = {
  id: string;
  phone: string;
  type: "meta" | "uazapi" | "wppconnect" | "evolution";
  status: string;
  connected: boolean;
  funnelId: string;
  funnelName: string;
  qr?: string | null; // QR cru (sem renderizar PNG) — só relevante pra conexões uazapi pareando
};

export type ConnectionMetrics = LiveConnection & {
  conversationCount: number;
  messageCount: number;
  leadsTotal: number;
  leadsNeedingHuman: number;
  resolutionRate: number | null; // 0-1, null quando leadsTotal === 0
};

const WINDOW_MS_DEFAULT = 7 * 24 * 60 * 60 * 1000;

/** Live-ping de todas as conexões (meta/uazapi/wppconnect) de um cliente.
 *  Mesmo comportamento/fallbacks de connection-status/route.ts, mas em paralelo. */
export async function getLiveConnectionsForClient(clientId: string): Promise<LiveConnection[]> {
  const funnels = getFunnels().filter((f) => f.clientId === clientId);
  const seen = new Set<string>();
  const tasks: Promise<LiveConnection>[] = [];

  for (const funnel of funnels) {
    for (const conn of funnel.connections ?? []) {
      if (seen.has(conn.id)) continue;
      seen.add(conn.id);

      if (conn.type === "uazapi" && conn.uazapiToken) {
        tasks.push(
          getInstanceStatus(conn.uazapiToken)
            .then((st) => ({
              id: conn.id,
              phone: st.phone ?? conn.phone ?? conn.id,
              type: "uazapi" as const,
              status: st.status,
              connected: st.status === "connected",
              funnelId: funnel.id,
              funnelName: funnel.name,
              qr: st.qr ?? null,
            }))
            .catch(() => ({
              id: conn.id,
              phone: conn.phone,
              type: "uazapi" as const,
              status: "error",
              connected: false,
              funnelId: funnel.id,
              funnelName: funnel.name,
            }))
        );
      } else if (conn.type === "meta") {
        tasks.push(
          Promise.resolve({
            id: conn.id,
            phone: conn.metaPhoneNumberId ?? conn.phone ?? "",
            type: "meta" as const,
            status: "connected",
            connected: true,
            funnelId: funnel.id,
            funnelName: funnel.name,
          })
        );
      }
    }
  }

  const clientFunnelIds = new Set(funnels.map((f) => f.id));
  const wppSessions = getWppSessions().filter(
    (s) => s.clientId === clientId || (s.funnelId && clientFunnelIds.has(s.funnelId))
  );
  for (const s of wppSessions) {
    const linkedFunnel = funnels.find((f) => f.id === s.funnelId);
    tasks.push(
      checkConnectionStatus(s.sessionName, s.sessionToken)
        .then((status) => ({
          id: s.id,
          phone: s.sessionName,
          type: "wppconnect" as const,
          status,
          // UNKNOWN = timeout/resposta inesperada; se a IA funciona a sessão provavelmente está ativa
          connected: status === "CONNECTED" || status === "UNKNOWN",
          funnelId: linkedFunnel?.id ?? "",
          funnelName: linkedFunnel?.name ?? "Sem funil",
        }))
        // Em caso de erro de rede, exibe como conectado para não assustar o cliente
        .catch(() => ({
          id: s.id,
          phone: s.sessionName,
          type: "wppconnect" as const,
          status: "UNKNOWN",
          connected: true,
          funnelId: linkedFunnel?.id ?? "",
          funnelName: linkedFunnel?.name ?? "Sem funil",
        }))
    );
  }

  const evoSessions = getEvolutionSessions().filter(
    (s) => s.clientId === clientId || (s.funnelId && clientFunnelIds.has(s.funnelId))
  );
  for (const s of evoSessions) {
    const linkedFunnel = funnels.find((f) => f.id === s.funnelId);
    tasks.push(
      checkEvolutionConnectionStatus(s.instanceName)
        .then(async (status) => ({
          id: s.id,
          phone: (await getInstancePhone(s.instanceName).catch(() => null)) ?? s.instanceName,
          type: "evolution" as const,
          status,
          connected: status === "CONNECTED" || status === "UNKNOWN",
          funnelId: linkedFunnel?.id ?? "",
          funnelName: linkedFunnel?.name ?? "Sem funil",
        }))
        .catch(() => ({
          id: s.id,
          phone: s.instanceName,
          type: "evolution" as const,
          status: "UNKNOWN",
          connected: true,
          funnelId: linkedFunnel?.id ?? "",
          funnelName: linkedFunnel?.name ?? "Sem funil",
        }))
    );
  }

  return Promise.all(tasks);
}

/** Métricas de atendimento por conexão: volume (conversas/mensagens na janela) e
 *  taxa de resolução da IA (foto do momento atual — não é histórico). */
export async function getConnectionMetricsForClient(
  clientId: string,
  windowMs: number = WINDOW_MS_DEFAULT
): Promise<ConnectionMetrics[]> {
  const [connections, conversations, leads] = [
    await getLiveConnectionsForClient(clientId),
    getAllConversationsByClientId(clientId),
    getLeads(clientId),
  ];

  const since = Date.now() - windowMs;

  return connections.map((conn) => {
    const convsForConn = conversations.filter((c) => c.connId === conn.id);
    const recentConvs = convsForConn.filter((c) => c.lastActivity >= since);

    const messageCount = recentConvs.reduce((sum, c) => {
      const history = getHistory(c.phone, clientId, conn.id);
      return sum + history.filter((m) => m.ts >= since).length;
    }, 0);

    // Junta leads a esta conexão pelo telefone (best-effort — Lead não guarda connId)
    const convPhoneSet = new Set(convsForConn.map((c) => c.phone));
    const leadsForConn = leads.filter((l) =>
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
  });
}

export async function getConnectionMetricsForAllClients(
  windowMs?: number
): Promise<Array<{ clientId: string; clientName: string; connections: ConnectionMetrics[] }>> {
  const clients = getClients();
  const results = await Promise.all(
    clients.map(async (c) => ({
      clientId: c.id,
      clientName: c.name,
      connections: await getConnectionMetricsForClient(c.id, windowMs),
    }))
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
