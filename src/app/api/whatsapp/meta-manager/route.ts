import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getFunnels, updateFunnel, createFunnel } from "@/lib/funnels";
import { getClients, upsertClient } from "@/lib/clients";

export type MetaConnectionEnriched = {
  id: string;
  phoneNumberId: string;
  tokenMasked: string;
  verifyToken: string;
  funnelId: string;
  funnelName: string;
  clientId: string | null;
  clientName: string | null;
  hasAgentLinked: boolean;
  agentEnabled: boolean;
};

// GET — lista todas as conexões Meta
export async function GET() {
  const session = await getSession();
  if (!session || session.role !== "manager") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const funnels = getFunnels();
  const clients = getClients();

  const connIdToClient = new Map<string, { clientId: string; clientName: string; agentEnabled: boolean }>();
  for (const client of clients) {
    if (client.agentConfig?.whatsappConnectionId) {
      connIdToClient.set(client.agentConfig.whatsappConnectionId, {
        clientId: client.id,
        clientName: client.name,
        agentEnabled: client.agentConfig.enabled ?? false,
      });
    }
  }

  const result: MetaConnectionEnriched[] = [];
  for (const funnel of funnels) {
    for (const conn of funnel.connections ?? []) {
      if (conn.type !== "meta") continue;
      const clientInfo = connIdToClient.get(conn.id) ?? null;
      const linkedClientId = funnel.clientId ?? clientInfo?.clientId ?? null;
      const linkedClientName = linkedClientId
        ? (clients.find(c => c.id === linkedClientId)?.name ?? null)
        : null;
      result.push({
        id: conn.id,
        phoneNumberId: conn.metaPhoneNumberId ?? "",
        tokenMasked: conn.metaToken ? "••••••••" + conn.metaToken.slice(-4) : "",
        verifyToken: conn.metaVerifyToken ?? "trafegopago",
        funnelId: funnel.id,
        funnelName: funnel.name,
        clientId: linkedClientId,
        clientName: linkedClientName,
        hasAgentLinked: !!clientInfo,
        agentEnabled: clientInfo?.agentEnabled ?? false,
      });
    }
  }

  return NextResponse.json(result);
}

// POST — adiciona nova conexão Meta a um funil
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "manager") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json() as {
    funnelId: string;
    phoneNumberId: string;
    token: string;
    verifyToken?: string;
    clientId?: string | null;
    linkAgent?: boolean;
  };

  const { funnelId: rawFunnelId, phoneNumberId, token, verifyToken, clientId, linkAgent } = body;

  if (!rawFunnelId || !phoneNumberId?.trim() || !token?.trim()) {
    return NextResponse.json({ error: "funnelId, phoneNumberId e token são obrigatórios" }, { status: 400 });
  }

  // Auto-create funnel if value is "auto:clientId"
  let funnelId = rawFunnelId;
  if (funnelId.startsWith("auto:")) {
    const autoClientId = funnelId.slice(5);
    const newFunnel = createFunnel("Funil Principal");
    updateFunnel(newFunnel.id, { clientId: autoClientId });
    funnelId = newFunnel.id;
  }

  const funnels = getFunnels();
  const funnel = funnels.find(f => f.id === funnelId);
  if (!funnel) return NextResponse.json({ error: "Funil não encontrado" }, { status: 404 });

  const connId = `meta_${funnelId}_${Date.now()}`;
  const newConn = {
    id: connId,
    phone: phoneNumberId.trim(),
    type: "meta" as const,
    metaPhoneNumberId: phoneNumberId.trim(),
    metaToken: token.trim(),
    metaVerifyToken: verifyToken?.trim() || "trafegopago",
  };

  updateFunnel(funnelId, { connections: [...(funnel.connections ?? []), newConn] });

  // Vincula agente IA se fornecido
  if (clientId && linkAgent) {
    const clients = getClients();
    const client = clients.find(c => c.id === clientId);
    if (client) {
      upsertClient({
        ...client,
        agentConfig: {
          ...(client.agentConfig ?? { enabled: false, followUpEnabled: false, followUps: [] }),
          whatsappConnectionId: connId,
        },
      });
    }
  }

  return NextResponse.json({ ok: true, connId });
}

// PUT — atualiza vínculo (funil + cliente) de uma conexão existente
export async function PUT(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "manager") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json() as {
    connId: string;
    newFunnelId?: string;
    clientId?: string | null;
    linkAgent?: boolean;
  };

  const { connId, newFunnelId: rawNewFunnelId, clientId, linkAgent } = body;
  if (!connId) return NextResponse.json({ error: "connId obrigatório" }, { status: 400 });

  // Auto-create funnel if value is "auto:clientId"
  let newFunnelId = rawNewFunnelId;
  if (newFunnelId?.startsWith("auto:")) {
    const autoClientId = newFunnelId.slice(5);
    const created = createFunnel("Funil Principal");
    updateFunnel(created.id, { clientId: autoClientId });
    newFunnelId = created.id;
  }

  const funnels = getFunnels();

  // Encontra a conexão no funil atual
  let foundConn: import("@/lib/funnels").FunnelConnection | null = null;
  let oldFunnelId: string | null = null;
  for (const funnel of funnels) {
    const conn = funnel.connections?.find(c => c.id === connId);
    if (conn) { foundConn = conn; oldFunnelId = funnel.id; break; }
  }

  if (!foundConn) return NextResponse.json({ error: "Conexão não encontrada" }, { status: 404 });

  // Move para outro funil se necessário
  if (newFunnelId && newFunnelId !== oldFunnelId) {
    const oldFunnel = funnels.find(f => f.id === oldFunnelId);
    if (oldFunnel) {
      updateFunnel(oldFunnelId!, {
        connections: (oldFunnel.connections ?? []).filter(c => c.id !== connId),
      });
    }
    const newFunnels = getFunnels();
    const newFunnel = newFunnels.find(f => f.id === newFunnelId);
    if (newFunnel) {
      updateFunnel(newFunnelId, { connections: [...(newFunnel.connections ?? []), foundConn] });
    }
  }

  // Atualiza vínculo de cliente
  const clients = getClients();
  for (const client of clients) {
    if (client.agentConfig?.whatsappConnectionId === connId && client.id !== clientId) {
      upsertClient({ ...client, agentConfig: { ...client.agentConfig, whatsappConnectionId: undefined } });
    }
  }
  if (clientId) {
    const client = clients.find(c => c.id === clientId);
    if (client) {
      upsertClient({
        ...client,
        agentConfig: {
          ...(client.agentConfig ?? { enabled: false, followUpEnabled: false, followUps: [] }),
          whatsappConnectionId: linkAgent ? connId : undefined,
        },
      });
    }
  }

  return NextResponse.json({ ok: true });
}

// DELETE — remove uma conexão Meta
export async function DELETE(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "manager") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { connId } = await req.json() as { connId: string };
  if (!connId) return NextResponse.json({ error: "connId obrigatório" }, { status: 400 });

  const funnels = getFunnels();
  for (const funnel of funnels) {
    if (funnel.connections?.some(c => c.id === connId)) {
      updateFunnel(funnel.id, {
        connections: (funnel.connections ?? []).filter(c => c.id !== connId),
      });
    }
  }

  const clients = getClients();
  for (const client of clients) {
    if (client.agentConfig?.whatsappConnectionId === connId) {
      upsertClient({ ...client, agentConfig: { ...client.agentConfig, whatsappConnectionId: undefined } });
    }
  }

  return NextResponse.json({ ok: true });
}
