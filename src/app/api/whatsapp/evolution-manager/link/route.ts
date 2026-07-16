import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getClients, upsertClient, migrateOrphanedAgentConfig, migrateAgentConfigByOldConnectionId } from "@/lib/clients";
import { getFunnels, createFunnel, updateFunnel } from "@/lib/funnels";
import { getEvolutionSessionById, getEvolutionSessions, updateEvolutionSession } from "@/lib/evolution-sessions";
import { getWppSessions } from "@/lib/wppconnect-sessions";

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "manager") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json() as {
    sessionId: string;
    funnelId: string | null;
    clientId: string | null;
    linkAgent: boolean;
    reuseConnectionId?: string;
  };

  const { sessionId, clientId, linkAgent, reuseConnectionId } = body;
  let { funnelId } = body;

  const evoSession = getEvolutionSessionById(sessionId);
  if (!evoSession) return NextResponse.json({ error: "Sessão não encontrada" }, { status: 404 });

  if (funnelId?.startsWith("auto:")) {
    const autoClientId = funnelId.slice(5);
    const newFunnel = createFunnel("Funil Principal");
    updateFunnel(newFunnel.id, { clientId: autoClientId });
    funnelId = newFunnel.id;
  }

  updateEvolutionSession(sessionId, {
    funnelId: funnelId ?? null,
    clientId: clientId ?? null,
    hasAgent: linkAgent,
  });

  const clients = getClients();

  for (const client of clients) {
    if (client.agentConfig?.whatsappConnectionId === sessionId && client.id !== clientId) {
      upsertClient({
        ...client,
        agentConfig: { ...client.agentConfig, whatsappConnectionId: undefined },
      });
    }
  }

  let migratedConfig = false;
  if (clientId) {
    const client = clients.find(c => c.id === clientId);
    if (client) {
      if (linkAgent) {
        if (reuseConnectionId) {
          migratedConfig = migrateAgentConfigByOldConnectionId(clientId, reuseConnectionId, sessionId);
        } else {
          // Conjunto de conexões "vivas" inclui funnels[].connections, sessões
          // WPPConnect E sessões Evolution — sem incluir estas últimas, uma
          // config órfã de uma instância Evolution excluída poderia nunca ser
          // detectada como ambígua/migrável corretamente.
          const liveConnectionIds = new Set<string>();
          for (const f of getFunnels()) for (const c of f.connections ?? []) liveConnectionIds.add(c.id);
          for (const s of getWppSessions()) liveConnectionIds.add(s.id);
          for (const s of getEvolutionSessions()) liveConnectionIds.add(s.id);
          migratedConfig = migrateOrphanedAgentConfig(clientId, sessionId, liveConnectionIds);
        }
      }

      const freshClient = getClients().find(c => c.id === clientId) ?? client;
      upsertClient({
        ...freshClient,
        agentConfig: {
          ...(freshClient.agentConfig ?? { enabled: false, followUpEnabled: false, followUps: [] }),
          whatsappConnectionId: linkAgent ? sessionId : undefined,
        },
      });
    }
  }

  return NextResponse.json({ ok: true, funnelId, migratedConfig });
}
