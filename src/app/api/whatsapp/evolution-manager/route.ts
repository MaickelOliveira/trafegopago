import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getClients, getAllAgentConfigs } from "@/lib/clients";
import { getFunnels } from "@/lib/funnels";
import {
  createOrRestartInstance,
  logoutInstance,
  checkConnectionStatus,
  isEvolutionConfigured,
  getInstancePhone,
} from "@/lib/evolution-api";
import {
  getEvolutionSessions,
  createEvolutionSession,
  updateEvolutionSession,
} from "@/lib/evolution-sessions";

export type EnrichedEvolutionSession = {
  id: string;
  instanceName: string;
  status: string;
  phone: string | null;
  linkedFunnelId: string | null;
  linkedFunnelName: string | null;
  linkedClientId: string | null;
  linkedClientName: string | null;
  hasAgentLinked: boolean;
  agentEnabled: boolean;
  instanceWebhookUrl: string;
};

function detectBase(req: NextRequest): string {
  const fwdHost  = req.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const fwdProto = req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() ?? "https";
  return fwdHost ? `${fwdProto}://${fwdHost}` : `${req.nextUrl.protocol}//${req.nextUrl.host}`;
}

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session || (session.role !== "manager" && session.role !== "client" && session.role !== "employee")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const baseUrl = detectBase(req);
  let storedSessions = getEvolutionSessions();
  const funnels = getFunnels();
  const clients = getClients();

  if (session.role !== "manager" && session.clientId) {
    const clientFunnelIds = new Set(
      funnels.filter(f => f.clientId === session.clientId).map(f => f.id)
    );
    storedSessions = storedSessions.filter(
      s => s.clientId === session.clientId || (s.funnelId && clientFunnelIds.has(s.funnelId))
    );
  }

  // Considera TODAS as configs do cliente (agentConfig legado + agentConfigs[]
  // por conexão) — olhar só o campo legado faz uma instância cujo agente foi
  // salvo no array (fluxo normal da tela de edição) aparecer como "sem agente
  // vinculado" mesmo com a config certinha salva.
  const connIdToClient = new Map<string, { clientId: string; clientName: string; agentEnabled: boolean }>();
  for (const client of clients) {
    for (const cfg of getAllAgentConfigs(client)) {
      if (cfg.whatsappConnectionId) {
        connIdToClient.set(cfg.whatsappConnectionId, {
          clientId: client.id,
          clientName: client.name,
          agentEnabled: cfg.enabled ?? false,
        });
      }
    }
  }

  const enriched: EnrichedEvolutionSession[] = await Promise.all(
    storedSessions.map(async (s) => {
      const rawStatus = await checkConnectionStatus(s.instanceName).catch(() => "DISCONNECTED");
      const connected = rawStatus === "CONNECTED";
      const connecting = rawStatus === "QRCODE";
      const phone = connected ? await getInstancePhone(s.instanceName).catch(() => null) : null;

      const funnelObj = s.funnelId ? funnels.find(f => f.id === s.funnelId) : null;
      const clientInfo = connIdToClient.get(s.id);

      const linkedClientId = s.clientId ?? clientInfo?.clientId ?? null;
      const linkedClientName = linkedClientId ? (clients.find(c => c.id === linkedClientId)?.name ?? null) : null;

      return {
        id: s.id,
        instanceName: s.instanceName,
        status: connected ? "connected" : connecting ? "connecting" : "disconnected",
        phone,
        linkedFunnelId: s.funnelId,
        linkedFunnelName: funnelObj?.name ?? null,
        linkedClientId,
        linkedClientName,
        hasAgentLinked: !!clientInfo,
        agentEnabled: clientInfo?.agentEnabled ?? false,
        instanceWebhookUrl: session.role === "manager" ? `${baseUrl}/api/whatsapp/webhook/evolution/${s.id}` : "",
      };
    })
  );

  return NextResponse.json(enriched);
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "manager") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isEvolutionConfigured()) {
    return NextResponse.json(
      { error: "Evolution API não configurada. Defina o servidor e a API key em Configurações." },
      { status: 400 }
    );
  }

  const { name } = await req.json() as { name: string };
  if (!name?.trim()) {
    return NextResponse.json({ error: "Nome obrigatório" }, { status: 400 });
  }

  const instanceName = name.trim().toLowerCase().replace(/[^a-z0-9-]/g, "-");
  const baseUrl = detectBase(req);

  // Cria o registro local primeiro (precisa do id/UUID pra montar a URL do
  // webhook que é passada na própria chamada de criação da instância).
  const evoSession = createEvolutionSession(instanceName, "");

  // Limpa qualquer instância zumbi com esse mesmo nome — mesmo racional do
  // logoutSession preventivo do WPPConnect antes de criar/reiniciar.
  await logoutInstance(instanceName).catch(() => {});

  const webhookUrl = `${baseUrl}/api/whatsapp/webhook/evolution/${evoSession.id}`;
  const result = await createOrRestartInstance(instanceName, webhookUrl);
  if (!result) {
    return NextResponse.json(
      { error: "Não foi possível criar a instância. Verifique a URL do servidor e a API key admin." },
      { status: 500 }
    );
  }
  if (result.apiKey) {
    updateEvolutionSession(evoSession.id, { instanceApiKey: result.apiKey });
  }

  return NextResponse.json({ id: evoSession.id, instanceName, ok: true });
}
