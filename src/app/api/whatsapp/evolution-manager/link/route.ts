import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getClients, getClientById, getAllAgentConfigs, patchClient, upsertAgentConfigForConnection } from "@/lib/clients";
import type { AgentConfig } from "@/lib/clients";
import { createFunnel, updateFunnel, getFunnels } from "@/lib/funnels";
import { getEvolutionSessionById, updateEvolutionSession } from "@/lib/evolution-sessions";
import { withDataTransaction } from "@/lib/document-store";

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "manager") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { sessionId: string; funnelId: string | null; clientId: string | null; linkAgent: boolean; reuseConnectionId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Dados de vínculo inválidos." }, { status: 400 });
  }
  if (!body || typeof body.sessionId !== "string" || !body.sessionId
    || typeof body.linkAgent !== "boolean"
    || (body.clientId !== null && typeof body.clientId !== "string")
    || (body.funnelId !== null && typeof body.funnelId !== "string")
    || (body.reuseConnectionId !== undefined && typeof body.reuseConnectionId !== "string")) {
    return NextResponse.json({ error: "Dados de vínculo inválidos." }, { status: 400 });
  }
  const { sessionId, clientId, linkAgent, reuseConnectionId } = body;
  if (linkAgent && !clientId) {
    return NextResponse.json({ error: "Selecione o cliente do agente." }, { status: 400 });
  }

  // Cliente, funil e agente precisam ser gravados juntos. Uma falha não pode
  // deixar a sessão vinculada enquanto a configuração do atendimento se perde.
  return withDataTransaction(async () => {
    const evoSession = await getEvolutionSessionById(sessionId);
    if (!evoSession) return NextResponse.json({ error: "Sessão não encontrada" }, { status: 404 });
    const clients = await getClients();
    const target = clientId ? clients.find(client => client.id === clientId) : undefined;
    if (clientId && !target) {
      return NextResponse.json({ error: "Cliente não encontrado." }, { status: 404 });
    }

    // Reaproveitar exige a seleção explícita do gestor. Sem seleção, mantém
    // somente o agente desta conexão ou cria uma configuração desativada.
    const agentSource = reuseConnectionId && linkAgent ? reuseConnectionId : sessionId;
    const selected = target ? getAllAgentConfigs(target).find(cfg => cfg.whatsappConnectionId === agentSource) : undefined;
    if (linkAgent && reuseConnectionId && !selected) {
      return NextResponse.json({ error: "O agente selecionado não pertence a este cliente." }, { status: 400 });
    }

    let { funnelId } = body;
    const funnels = await getFunnels();
    if (funnelId?.startsWith("auto:")) {
      const ownerId = funnelId.slice(5);
      if (!clients.some(client => client.id === ownerId) || (clientId && ownerId !== clientId)) {
        return NextResponse.json({ error: "Cliente do funil inválido." }, { status: 400 });
      }
      const existing = funnels.find(funnel => funnel.clientId === ownerId);
      if (existing) funnelId = existing.id;
      else {
        const created = await createFunnel("Funil Principal");
        await updateFunnel(created.id, { clientId: ownerId });
        funnelId = created.id;
      }
    } else if (!funnelId && clientId) {
      // O recebimento depende de um funil. O cadastro do cliente já fornece
      // esse vínculo, sem exigir uma configuração oculta depois de conectar.
      const existing = funnels.find(funnel => funnel.clientId === clientId);
      if (existing) funnelId = existing.id;
      else {
        const created = await createFunnel("Funil Principal");
        await updateFunnel(created.id, { clientId });
        funnelId = created.id;
      }
    } else if (funnelId && !funnels.some(funnel => funnel.id === funnelId)) {
      return NextResponse.json({ error: "Funil não encontrado." }, { status: 404 });
    }

    // Remove apenas o vínculo que está sendo alterado, nos dois formatos.
    // As instruções e as demais conexões de cada cliente são preservadas.
    for (const client of clients) {
      const removeIds = new Set<string>();
      if (client.id !== clientId || !linkAgent) removeIds.add(sessionId);
      if (client.id === clientId && linkAgent && reuseConnectionId && reuseConnectionId !== sessionId) {
        removeIds.add(reuseConnectionId);
      }
      if (removeIds.size === 0) continue;
      const matches = (cfg: AgentConfig) => !!cfg.whatsappConnectionId && removeIds.has(cfg.whatsappConnectionId);
      const patch: { agentConfig?: AgentConfig; agentConfigs?: AgentConfig[] } = {};
      if (client.agentConfig && matches(client.agentConfig)) {
        patch.agentConfig = { ...client.agentConfig, enabled: false, followUpEnabled: false, whatsappConnectionId: undefined };
      }
      if (client.agentConfigs?.some(matches)) {
        patch.agentConfigs = client.agentConfigs.map(cfg => matches(cfg) ? { ...cfg, enabled: false, whatsappConnectionId: undefined } : cfg);
      }
      if (Object.keys(patch).length) await patchClient(client.id, patch);
    }

    await updateEvolutionSession(sessionId, { funnelId: funnelId ?? null, clientId: clientId ?? null, hasAgent: linkAgent });
    if (target && linkAgent) {
      const fresh = await getClientById(target.id);
      if (!fresh) throw new Error("Cliente não encontrado.");
      await upsertAgentConfigForConnection(fresh, sessionId, {
        ...(selected ?? { enabled: false, followUpEnabled: false, followUps: [] }),
        whatsappConnectionId: sessionId,
      });
    }
    if (target && linkAgent && reuseConnectionId && reuseConnectionId !== sessionId) {
      const previousSession = await getEvolutionSessionById(reuseConnectionId);
      if (previousSession?.clientId === target.id) await updateEvolutionSession(reuseConnectionId, { hasAgent: false });
    }

    return NextResponse.json({ ok: true, funnelId, migratedConfig: !!(linkAgent && reuseConnectionId && selected) });
  });
}
