import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getClientById, upsertClient } from "@/lib/clients";
import type { AgentConfig } from "@/lib/clients";

function getConfigForConn(client: ReturnType<typeof getClientById>, connId: string | null): AgentConfig {
  if (connId && client?.agentConfigs) {
    const found = client.agentConfigs.find(c => c.whatsappConnectionId === connId);
    if (found) return found;
  }
  return client?.agentConfig ?? { enabled: false, followUpEnabled: false, followUps: [] };
}

function upsertConfigForConn(
  client: NonNullable<ReturnType<typeof getClientById>>,
  connId: string | null,
  updated: AgentConfig
) {
  if (connId) {
    // Upsert em agentConfigs
    const existing = client.agentConfigs ?? [];
    const idx = existing.findIndex(c => c.whatsappConnectionId === connId);
    const newConfigs = [...existing];
    if (idx >= 0) newConfigs[idx] = updated;
    else newConfigs.push({ ...updated, whatsappConnectionId: connId });
    upsertClient({ ...client, agentConfigs: newConfigs });
  } else {
    // Salva no agentConfig padrão
    upsertClient({ ...client, agentConfig: updated });
  }
}

// GET /api/agent?clientId=xxx[&connId=yyy] — retorna config do agente
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "manager") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const clientId = req.nextUrl.searchParams.get("clientId");
  if (!clientId) return NextResponse.json({ error: "clientId required" }, { status: 400 });

  const client = getClientById(clientId);
  if (!client) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const connId = req.nextUrl.searchParams.get("connId");
  const cfg = getConfigForConn(client, connId);

  // Retorna também um resumo de todos os agentConfigs (sem dados sensíveis)
  const allConfigs = [...(client.agentConfigs ?? [])];
  if (client.agentConfig && !allConfigs.some(c => c.whatsappConnectionId === client.agentConfig?.whatsappConnectionId)) {
    allConfigs.push(client.agentConfig);
  }
  const configsSummary = allConfigs.map(c => ({
    whatsappConnectionId: c.whatsappConnectionId,
    enabled: c.enabled,
    followUpEnabled: c.followUpEnabled,
    name: c.name,
  }));

  // Não expõe tokens sensíveis — retorna booleano se conectado
  return NextResponse.json({
    ...cfg,
    googleRefreshToken: undefined,
    calendarConnected: !!cfg.googleRefreshToken,
    _agentConfigsSummary: connId ? undefined : configsSummary,
  });
}

// PUT /api/agent?clientId=xxx[&connId=yyy] — salva config do agente
export async function PUT(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "manager") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const clientId = req.nextUrl.searchParams.get("clientId");
  if (!clientId) return NextResponse.json({ error: "clientId required" }, { status: 400 });

  const client = getClientById(clientId);
  if (!client) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const connId = req.nextUrl.searchParams.get("connId");
  const body = await req.json().catch(() => ({})) as Partial<AgentConfig>;
  const current = getConfigForConn(client, connId);

  // Preserva googleRefreshToken existente se não foi alterado
  const updated: AgentConfig = {
    ...current,
    ...body,
    googleRefreshToken: body.googleRefreshToken ?? current.googleRefreshToken,
  };

  upsertConfigForConn(client, connId, updated);
  return NextResponse.json({ ok: true });
}

// PATCH /api/agent?clientId=xxx[&connId=yyy] — toggle enabled / followUpEnabled
export async function PATCH(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "manager") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const clientId = req.nextUrl.searchParams.get("clientId");
  if (!clientId) return NextResponse.json({ error: "clientId required" }, { status: 400 });

  const client = getClientById(clientId);
  if (!client) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const connId = req.nextUrl.searchParams.get("connId");
  const body = await req.json().catch(() => ({})) as { field: "enabled" | "followUpEnabled"; value: boolean };
  const current = getConfigForConn(client, connId);
  const updated = { ...current, [body.field]: body.value };

  upsertConfigForConn(client, connId, updated);
  return NextResponse.json({ ok: true, [body.field]: body.value });
}
