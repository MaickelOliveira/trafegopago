import { NextRequest, NextResponse } from "next/server";
import { getClientById, getAllAgentConfigs, getAgentConfigForConnection } from "@/lib/clients";
import { getFunnels } from "@/lib/funnels";
import { getWppSessions } from "@/lib/wppconnect-sessions";
import { getEvolutionSessions } from "@/lib/evolution-sessions";

export const dynamic = "force-dynamic";

/** Lista, sem expor segredos, as configs relevantes de splitMessages/messageWaitSeconds por conexão. */
export async function GET(req: NextRequest) {
  const clientId = req.nextUrl.searchParams.get("clientId");
  if (!clientId) return NextResponse.json({ error: "clientId required" }, { status: 400 });

  const client = getClientById(clientId);
  if (!client) return NextResponse.json({ error: "client not found" }, { status: 404 });

  const funnels = getFunnels().filter((f) => f.clientId === clientId);
  const connections: { id: string; type: string; phone?: string }[] = funnels
    .flatMap((f) => f.connections ?? [])
    .map((c) => ({ id: c.id, type: c.type, phone: c.phone }));

  // Sessões WPPConnect vinculadas aos funis deste cliente
  const clientFunnelIds = new Set(funnels.map((f) => f.id));
  const wppSessions = getWppSessions().filter((s) => s.funnelId && clientFunnelIds.has(s.funnelId));
  for (const s of wppSessions) {
    connections.push({ id: s.id, type: "wppconnect", phone: s.sessionName });
  }

  // Instâncias Evolution vinculadas aos funis deste cliente
  const evoSessions = getEvolutionSessions().filter((s) => s.funnelId && clientFunnelIds.has(s.funnelId));
  for (const s of evoSessions) {
    connections.push({ id: s.id, type: "evolution", phone: s.instanceName });
  }

  // Para cada conexão, mostra qual agentConfig é REALMENTE resolvido (incluindo fallback)
  const resolved = connections.map((c) => {
    const cfg = getAgentConfigForConnection(client, c.id);
    return {
      connectionId: c.id,
      connectionType: c.type,
      connectionPhone: c.phone,
      resolvedAgent: cfg
        ? {
            name: cfg.name,
            enabled: cfg.enabled,
            splitMessages: cfg.splitMessages,
            maxMessageLength: cfg.maxMessageLength,
            messageWaitSeconds: cfg.messageWaitSeconds,
          }
        : null,
    };
  });

  const configs = getAllAgentConfigs(client).map((cfg) => ({
    name: cfg.name,
    whatsappConnectionId: cfg.whatsappConnectionId,
    enabled: cfg.enabled,
    splitMessages: cfg.splitMessages,
    maxMessageLength: cfg.maxMessageLength,
    messageWaitSeconds: cfg.messageWaitSeconds,
    followUpEnabled: cfg.followUpEnabled,
  }));

  return NextResponse.json({ clientId, connections, resolved, configs });
}
