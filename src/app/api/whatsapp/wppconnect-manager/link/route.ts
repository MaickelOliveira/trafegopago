import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getClients, upsertClient, migrateOrphanedAgentConfig } from "@/lib/clients";
import { getFunnels, createFunnel, updateFunnel } from "@/lib/funnels";
import { getWppSessionById, getWppSessions, updateWppSession } from "@/lib/wppconnect-sessions";

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
  };

  const { sessionId, clientId, linkAgent } = body;
  let { funnelId } = body;

  const wppSession = getWppSessionById(sessionId);
  if (!wppSession) return NextResponse.json({ error: "Sessão não encontrada" }, { status: 404 });

  // Auto-criar funil se necessário
  if (funnelId?.startsWith("auto:")) {
    const autoClientId = funnelId.slice(5);
    const newFunnel = createFunnel("Funil Principal");
    updateFunnel(newFunnel.id, { clientId: autoClientId });
    funnelId = newFunnel.id;
  }

  // Atualiza registro local
  updateWppSession(sessionId, {
    funnelId: funnelId ?? null,
    clientId: clientId ?? null,
    hasAgent: linkAgent,
  });

  // Atualiza agentConfig dos clientes
  const clients = getClients();

  // Remove vínculo de outros clientes
  for (const client of clients) {
    if (client.agentConfig?.whatsappConnectionId === sessionId && client.id !== clientId) {
      upsertClient({
        ...client,
        agentConfig: { ...client.agentConfig, whatsappConnectionId: undefined },
      });
    }
  }

  // Vincula ao cliente alvo
  let migratedConfig = false;
  if (clientId) {
    const client = clients.find(c => c.id === clientId);
    if (client) {
      // Antes de criar uma config em branco para a conexão nova, tenta reaproveitar
      // uma config órfã (de uma instância antiga excluída/substituída) do mesmo
      // cliente — preserva prompt, follow-ups, base de conhecimento etc. sem precisar
      // reconfigurar do zero. Só migra quando não há ambiguidade (ver migrateOrphanedAgentConfig).
      if (linkAgent) {
        const liveConnectionIds = new Set<string>();
        for (const f of getFunnels()) for (const c of f.connections ?? []) liveConnectionIds.add(c.id);
        for (const s of getWppSessions()) liveConnectionIds.add(s.id);
        migratedConfig = migrateOrphanedAgentConfig(clientId, sessionId, liveConnectionIds);
      }

      // Reler o cliente: migrateOrphanedAgentConfig pode já ter persistido um novo
      // agentConfigs[] — usar a referência antiga aqui sobrescreveria essa mudança.
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
