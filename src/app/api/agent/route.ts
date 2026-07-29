import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getClientById, upsertClient } from "@/lib/clients";
import type { AgentConfig } from "@/lib/clients";

function getConfigForConn(client: ReturnType<typeof getClientById>, connId: string | null): AgentConfig {
  if (connId && client?.agentConfigs) {
    const found = client.agentConfigs.find(c => c.whatsappConnectionId === connId);
    if (found) return found;
  }
  // Sem connId explícito (ex: tela carregou sem nenhuma conexão selecionada):
  // nunca devolve o campo legado "solto" quando o cliente já tem conexões em
  // agentConfigs[] — isso fazia a tela mostrar/editar uma config desconectada
  // da que realmente está em uso, e qualquer save ali nunca refletia no
  // agente de verdade. Tenta resolver pela conexão que o campo legado
  // aponta, senão cai na primeira conexão disponível.
  if (client?.agentConfigs?.length) {
    const viaLegacy = client.agentConfig?.whatsappConnectionId
      ? client.agentConfigs.find(c => c.whatsappConnectionId === client.agentConfig!.whatsappConnectionId)
      : undefined;
    return viaLegacy ?? client.agentConfigs[0];
  }
  return client?.agentConfig ?? { enabled: false, followUpEnabled: false, followUps: [] };
}

function upsertConfigForConn(
  client: NonNullable<ReturnType<typeof getClientById>>,
  connId: string | null,
  updated: AgentConfig
) {
  // Se a requisição não veio com connId (ex: a tela carregou sem nenhuma
  // conexão selecionada), mas o config sendo salvo JÁ identifica uma conexão
  // (updated.whatsappConnectionId, vindo do GET anterior), usa esse valor —
  // sem isso, o save caía no campo legado único (client.agentConfig), que
  // getAllAgentConfigs() ignora por completo assim que agentConfigs[] já tem
  // alguma entrada (caso de qualquer cliente com mais de uma conexão
  // configurada). O resultado prático: toggles como resumo diário/reativação
  // automática pareciam salvar (sem erro na tela) mas o cron nunca via a
  // mudança, porque ela foi parar num campo que ninguém mais lê.
  const effectiveConnId = connId ?? updated.whatsappConnectionId ?? null;
  if (effectiveConnId) {
    // Upsert em agentConfigs
    const existing = client.agentConfigs ?? [];
    const idx = existing.findIndex(c => c.whatsappConnectionId === effectiveConnId);
    const newConfigs = [...existing];
    const withConnId = { ...updated, whatsappConnectionId: effectiveConnId };
    if (idx >= 0) newConfigs[idx] = withConnId;
    else newConfigs.push(withConnId);
    upsertClient({ ...client, agentConfigs: newConfigs });
  } else {
    // Cliente sem nenhuma conexão configurada ainda — só aqui faz sentido
    // salvar no campo legado único.
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
