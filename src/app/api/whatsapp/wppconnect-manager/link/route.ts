import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getClients, upsertClient, migrateAgentConfigByOldConnectionId } from "@/lib/clients";
import { createFunnel, updateFunnel } from "@/lib/funnels";
import { getWppSessionById, updateWppSession } from "@/lib/wppconnect-sessions";

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
    reuseConnectionId?: string; // escolha manual de qual config órfã reaproveitar
  };

  const { sessionId, clientId, linkAgent, reuseConnectionId } = body;
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
      // Config de agente é uma entidade própria (identificada pelo seu
      // whatsappConnectionId atual, vivo ou órfão) — não presa ao ciclo de vida
      // da sessão. O front sempre manda explicitamente qual agente reaproveitar
      // (reuseConnectionId); sem escolha explícita, cria um agente em branco —
      // nada de adivinhar/auto-migrar por trás das costas do gestor.
      if (linkAgent && reuseConnectionId) {
        migratedConfig = migrateAgentConfigByOldConnectionId(clientId, reuseConnectionId, sessionId);
      }

      // Reler o cliente: migrateAgentConfigByOldConnectionId pode já ter persistido
      // um novo agentConfigs[] — usar a referência antiga aqui sobrescreveria essa mudança.
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
