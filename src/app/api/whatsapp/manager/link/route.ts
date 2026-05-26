import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getClients, upsertClient } from "@/lib/clients";
import { getFunnels, updateFunnel, createFunnel } from "@/lib/funnels";

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "manager") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json() as {
    instanceToken: string;
    instanceName: string;
    instancePhone: string;
    funnelId: string | null;
    clientId: string | null;
    linkAgent: boolean;
  };

  const { instanceToken, instanceName, instancePhone, funnelId, clientId, linkAgent } = body;

  if (!instanceToken || !instanceName) {
    return NextResponse.json({ error: "instanceToken e instanceName obrigatórios" }, { status: 400 });
  }

  const funnels = getFunnels();

  // 1. Remove this instance from any existing funnel
  for (const funnel of funnels) {
    const hasConn = funnel.connections?.some(
      c => c.type === "uazapi" && (c.uazapiToken === instanceToken || c.id === instanceName)
    );
    if (hasConn) {
      const newConnections = (funnel.connections ?? []).filter(
        c => !(c.type === "uazapi" && (c.uazapiToken === instanceToken || c.id === instanceName))
      );
      updateFunnel(funnel.id, { connections: newConnections });
    }
  }

  // 2. Resolve funnelId — auto-create if value is "auto:clientId"
  let resolvedFunnelId = funnelId;
  if (resolvedFunnelId?.startsWith("auto:")) {
    const autoClientId = resolvedFunnelId.slice(5);
    const newFunnel = createFunnel("Funil Principal");
    updateFunnel(newFunnel.id, { clientId: autoClientId });
    resolvedFunnelId = newFunnel.id;
  }

  // 3. Add to new funnel (if provided)
  if (resolvedFunnelId) {
    const targetFunnel = getFunnels().find(f => f.id === resolvedFunnelId);
    if (!targetFunnel) {
      return NextResponse.json({ error: "Funil não encontrado" }, { status: 404 });
    }
    const newConn = {
      id: instanceName,
      phone: instancePhone ?? "",
      type: "uazapi" as const,
      uazapiToken: instanceToken,
    };
    updateFunnel(resolvedFunnelId, {
      connections: [...(targetFunnel.connections ?? []), newConn],
    });
  }

  // 3. Update AI agent config
  const clients = getClients();

  // Clear agent link from any other client that had this connection
  for (const client of clients) {
    if (client.agentConfig?.whatsappConnectionId === instanceName && client.id !== clientId) {
      upsertClient({
        ...client,
        agentConfig: { ...client.agentConfig, whatsappConnectionId: undefined },
      });
    }
  }

  // Set/clear on the target client
  if (clientId) {
    const client = clients.find(c => c.id === clientId);
    if (client) {
      const newAgentConfig = {
        ...(client.agentConfig ?? { enabled: false, followUpEnabled: false, followUps: [] }),
        whatsappConnectionId: linkAgent ? instanceName : undefined,
      };
      upsertClient({ ...client, agentConfig: newAgentConfig });
    }
  }

  return NextResponse.json({ ok: true, funnelId: resolvedFunnelId, clientId });
}
