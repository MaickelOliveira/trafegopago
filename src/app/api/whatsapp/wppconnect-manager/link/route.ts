import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getClients, upsertClient } from "@/lib/clients";
import { getFunnels, createFunnel, updateFunnel } from "@/lib/funnels";
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
  if (clientId) {
    const client = clients.find(c => c.id === clientId);
    if (client) {
      upsertClient({
        ...client,
        agentConfig: {
          ...(client.agentConfig ?? { enabled: false, followUpEnabled: false, followUps: [] }),
          whatsappConnectionId: linkAgent ? sessionId : undefined,
        },
      });
    }
  }

  return NextResponse.json({ ok: true, funnelId });
}
