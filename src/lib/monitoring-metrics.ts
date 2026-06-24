// Camada de dados da Central de Monitoramento da IA: série diária de mensagens,
// mapa de calor hora x dia da semana, mapa de calor de urgência por lead e feed
// de atividade recente — tudo derivado de dados já existentes (conversations.ts,
// leads.ts, connection-metrics.ts), sem precisar de um log de eventos novo.
import { getAllConversationsByClientId, getHistory } from "@/lib/conversations";
import { getLeads } from "@/lib/leads";
import { getConnectionMetricsForClient, type ConnectionMetrics } from "@/lib/connection-metrics";

export type DailyPoint = { date: string; count: number };
export type ActivityEvent = {
  id: string;
  ts: number;
  type: "message" | "needs_attention" | "new_lead";
  title: string;
  detail?: string;
};
export type LeadHeat = { id: string; name: string; phone: string; tone: "red" | "amber" | "green"; reason: string };

export type ClientMonitoringData = {
  connections: ConnectionMetrics[];
  dailySeries: DailyPoint[];
  hourDayHeatmap: number[][]; // [7][24] — índice 0 = domingo (Date.getDay())
  leadHeatmap: LeadHeat[];
  feed: ActivityEvent[];
};

const TERMINAL_STATUSES = ["ganho", "perdido"];
const WINDOW_DAYS = 30;
const WINDOW_MS = WINDOW_DAYS * 24 * 60 * 60 * 1000;

function dateKey(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}

export async function getClientMonitoringData(clientId: string): Promise<ClientMonitoringData> {
  const since = Date.now() - WINDOW_MS;

  const connections = await getConnectionMetricsForClient(clientId);
  const conversations = getAllConversationsByClientId(clientId);
  const leads = getLeads(clientId);

  // ── Série diária + heatmap hora x dia (últimos 30 dias) ──────────────────
  const dailyMap = new Map<string, number>();
  const hourDayHeatmap: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0));

  for (const conv of conversations) {
    if (conv.lastActivity < since) continue;
    const history = getHistory(conv.phone, clientId, conv.connId ?? undefined);
    for (const msg of history) {
      if (msg.ts < since) continue;
      const d = new Date(msg.ts);
      const key = dateKey(msg.ts);
      dailyMap.set(key, (dailyMap.get(key) ?? 0) + 1);
      hourDayHeatmap[d.getDay()][d.getHours()] += 1;
    }
  }

  const dailySeries: DailyPoint[] = [];
  for (let i = WINDOW_DAYS - 1; i >= 0; i--) {
    const key = dateKey(Date.now() - i * 24 * 60 * 60 * 1000);
    dailySeries.push({ date: key, count: dailyMap.get(key) ?? 0 });
  }

  // ── Mapa de calor de urgência por lead (exclui leads em coluna final) ────
  const leadHeatmap: LeadHeat[] = leads
    .filter((l) => !TERMINAL_STATUSES.includes(l.status))
    .map((l) => {
      if (l.needsAttention) {
        return { id: l.id, name: l.name, phone: l.phone, tone: "red" as const, reason: l.needsAttentionReason ?? "IA pediu ajuda" };
      }
      if (l.aiPaused) {
        return { id: l.id, name: l.name, phone: l.phone, tone: "amber" as const, reason: "Conversa pausada (humano assumiu)" };
      }
      const score = l.ai?.score ?? 0;
      if (score >= 8) {
        return { id: l.id, name: l.name, phone: l.phone, tone: "amber" as const, reason: `Alta intenção (score ${score}/10) sem fechamento` };
      }
      return { id: l.id, name: l.name, phone: l.phone, tone: "green" as const, reason: "IA conduzindo normalmente" };
    });

  // ── Feed de atividade recente ─────────────────────────────────────────────
  const feed: ActivityEvent[] = [];

  for (const conv of conversations.slice(0, 30)) {
    if (!conv.lastMessage) continue;
    const who = conv.contactName ?? conv.phone;
    feed.push({
      id: `msg-${conv.connId ?? "x"}-${conv.phone}-${conv.lastMessage.ts}`,
      ts: conv.lastMessage.ts,
      type: "message",
      title: conv.lastMessage.role === "user" ? `${who} respondeu` : `IA respondeu a ${who}`,
      detail: conv.lastMessage.content?.slice(0, 80),
    });
  }

  for (const l of leads) {
    if (l.needsAttention && l.needsAttentionAt) {
      feed.push({
        id: `attn-${l.id}`,
        ts: new Date(l.needsAttentionAt).getTime(),
        type: "needs_attention",
        title: `⚠️ IA pediu ajuda com ${l.name}`,
        detail: l.needsAttentionReason,
      });
    }
    const createdTs = new Date(l.createdAt).getTime();
    if (createdTs >= since) {
      feed.push({ id: `new-${l.id}`, ts: createdTs, type: "new_lead", title: `🆕 Novo lead: ${l.name}` });
    }
  }

  feed.sort((a, b) => b.ts - a.ts);

  return { connections, dailySeries, hourDayHeatmap, leadHeatmap, feed: feed.slice(0, 20) };
}
