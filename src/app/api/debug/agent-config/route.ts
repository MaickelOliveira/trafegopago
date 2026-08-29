import { NextRequest, NextResponse } from "next/server";
import { getClientById, getAllAgentConfigs, getAgentConfigForConnection, getConfig, isWithinBusinessHours } from "@/lib/clients";
import { getFunnels } from "@/lib/funnels";
import { getWppSessions } from "@/lib/wppconnect-sessions";
import { getEvolutionSessions } from "@/lib/evolution-sessions";

export const dynamic = "force-dynamic";

// Mostra só os 4 últimos caracteres — o suficiente pra confirmar "é essa chave
// mesmo" sem expor o segredo completo numa rota sem autenticação.
function maskKey(key: string | null | undefined): string | null {
  if (!key) return null;
  return key.length <= 4 ? "****" : `****${key.slice(-4)}`;
}

// Mesma ordem de fallback de getGeminiApiKey() em whatsapp-send.ts, mas retorna
// também a FONTE (pra saber se veio do agente, do config global ou do ambiente)
// em vez de só o valor — evitando duplicar getGeminiApiKey só pra isso.
function resolveGeminiKeyWithSource(clientGeminiKey?: string): { source: string; masked: string | null } {
  const config = getConfig();
  if (clientGeminiKey) return { source: "agentConfig.geminiApiKey (específica)", masked: maskKey(clientGeminiKey) };
  if (config.geminiApiKey) return { source: "config global (Configurações)", masked: maskKey(config.geminiApiKey) };
  if (process.env.GEMINI_API_KEY) return { source: "env GEMINI_API_KEY", masked: maskKey(process.env.GEMINI_API_KEY) };
  if (process.env.GOOGLE_IMAGEN_API_KEY) return { source: "env GOOGLE_IMAGEN_API_KEY", masked: maskKey(process.env.GOOGLE_IMAGEN_API_KEY) };
  return { source: "nenhuma configurada", masked: null };
}

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
            geminiKey: resolveGeminiKeyWithSource(cfg.geminiApiKey),
            greetingOnlyMode: cfg.greetingOnlyMode ?? false,
            greetingOnlyMessage: cfg.greetingOnlyMessage ?? null,
            businessHoursEnabled: cfg.businessHoursEnabled ?? false,
            businessHoursStart: cfg.businessHoursStart ?? null,
            businessHoursEnd: cfg.businessHoursEnd ?? null,
            businessHoursDays: cfg.businessHoursDays ?? null,
            isWithinBusinessHoursNow: isWithinBusinessHours(cfg),
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
    dailySummaryEnabled: cfg.dailySummaryEnabled,
    dailySummaryTime: cfg.dailySummaryTime,
    dailySummaryLastSentDate: cfg.dailySummaryLastSentDate,
    aiAutoResumeEnabled: cfg.aiAutoResumeEnabled,
    aiAutoResumeMode: cfg.aiAutoResumeMode,
    aiAutoResumeHours: cfg.aiAutoResumeHours,
    greetingOnlyMode: cfg.greetingOnlyMode ?? false,
    greetingOnlyMessage: cfg.greetingOnlyMessage ?? null,
    businessHoursEnabled: cfg.businessHoursEnabled ?? false,
    businessHoursStart: cfg.businessHoursStart ?? null,
    businessHoursEnd: cfg.businessHoursEnd ?? null,
    businessHoursDays: cfg.businessHoursDays ?? null,
    isWithinBusinessHoursNow: isWithinBusinessHours(cfg),
  }));

  // Leads pausados deste cliente e há quanto tempo — útil pra diagnosticar
  // a reativação automática sem expor dados sensíveis além do necessário.
  const { getLeads } = await import("@/lib/leads");
  const leadsPausados = getLeads(clientId)
    .filter((l) => l.aiPaused)
    .map((l) => ({ id: l.id, phone: l.phone, aiPausedAt: l.aiPausedAt ?? null }));

  // O agente de gerenciamento de leads (kanban-agent.ts) NÃO usa
  // getAgentConfigForConnection — ele sempre lê client.agentConfig?.geminiApiKey
  // (o campo legado único), independente de quantas conexões/agentConfigs[]
  // o cliente tiver. Por isso é reportado à parte, não por conexão.
  const kanbanAgentGeminiKey = resolveGeminiKeyWithSource(client.agentConfig?.geminiApiKey);

  // client.agentConfig (campo legado único) fica invisível pra getAllAgentConfigs()
  // sempre que agentConfigs[] já tem alguma entrada — exposto aqui à parte pra
  // diagnosticar um save que caiu nesse campo por engano (ex: tela sem conexão
  // selecionada no momento de salvar) e nunca é considerado pelo cron.
  const legacyAgentConfig = client.agentConfig
    ? {
        name: client.agentConfig.name,
        whatsappConnectionId: client.agentConfig.whatsappConnectionId,
        dailySummaryEnabled: client.agentConfig.dailySummaryEnabled,
        dailySummaryTime: client.agentConfig.dailySummaryTime,
        aiAutoResumeEnabled: client.agentConfig.aiAutoResumeEnabled,
        ignoredByGetAllAgentConfigs: (client.agentConfigs?.length ?? 0) > 0,
      }
    : null;

  return NextResponse.json({ clientId, connections, resolved, configs, kanbanAgentGeminiKey, leadsPausados, legacyAgentConfig });
}
