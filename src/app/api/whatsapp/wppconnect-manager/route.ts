import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getClients } from "@/lib/clients";
import { getFunnels } from "@/lib/funnels";
import {
  generateToken,
  startSession,
  checkConnectionStatus,
  isWppConnectConfigured,
} from "@/lib/wppconnect-api";
import {
  getWppSessions,
  createWppSession,
} from "@/lib/wppconnect-sessions";

export type EnrichedWppSession = {
  id: string;
  sessionName: string;
  sessionToken: string;
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
  let storedSessions = getWppSessions();
  const funnels = getFunnels();
  const clients = getClients();

  // For non-managers: filter to sessions belonging to their clientId
  if (session.role !== "manager" && session.clientId) {
    const clientFunnelIds = new Set(
      funnels.filter(f => f.clientId === session.clientId).map(f => f.id)
    );
    storedSessions = storedSessions.filter(
      s => s.clientId === session.clientId || (s.funnelId && clientFunnelIds.has(s.funnelId))
    );
  }

  // Build client lookup: connectionId → client info
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

  // Enrich sessions with live status + funnel data
  const enriched: EnrichedWppSession[] = await Promise.all(
    storedSessions.map(async (s) => {
      const rawStatus = await checkConnectionStatus(s.sessionName, s.sessionToken).catch(() => "DISCONNECTED");
      const connected = rawStatus === "CONNECTED";
      const connecting = rawStatus === "QRCODE" || rawStatus === "STARTING";

      const funnelObj = s.funnelId ? funnels.find(f => f.id === s.funnelId) : null;
      const clientInfo = connIdToClient.get(s.id);

      const linkedClientId = s.clientId ?? clientInfo?.clientId ?? null;
      const linkedClientName = linkedClientId ? (clients.find(c => c.id === linkedClientId)?.name ?? null) : null;

      return {
        id: s.id,
        sessionName: s.sessionName,
        // Omit sessionToken for non-manager roles
        sessionToken: session.role === "manager" ? s.sessionToken : "",
        status: connected ? "connected" : connecting ? "connecting" : "disconnected",
        phone: null,
        linkedFunnelId: s.funnelId,
        linkedFunnelName: funnelObj?.name ?? null,
        linkedClientId,
        linkedClientName,
        hasAgentLinked: !!clientInfo,
        agentEnabled: clientInfo?.agentEnabled ?? false,
        instanceWebhookUrl: session.role === "manager" ? `${baseUrl}/api/whatsapp/webhook/wppconnect/${s.id}` : "",
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

  if (!isWppConnectConfigured()) {
    return NextResponse.json(
      { error: "WPPConnect não configurado. Defina WPPCONNECT_SERVER e WPPCONNECT_SECRET_KEY." },
      { status: 400 }
    );
  }

  const { name } = await req.json() as { name: string };
  if (!name?.trim()) {
    return NextResponse.json({ error: "Nome obrigatório" }, { status: 400 });
  }

  const sessionName = name.trim().toLowerCase().replace(/[^a-z0-9-]/g, "-");
  const baseUrl = detectBase(req);

  // 1. Gera token no WPPConnect
  const token = await generateToken(sessionName);
  if (!token) {
    return NextResponse.json(
      { error: "Não foi possível gerar token. Verifique WPPCONNECT_SERVER e WPPCONNECT_SECRET_KEY." },
      { status: 500 }
    );
  }

  // 2. Cria registro local
  const wppSession = createWppSession(sessionName, token);

  // 3. Inicia a sessão com webhook configurado
  const webhookUrl = `${baseUrl}/api/whatsapp/webhook/wppconnect/${wppSession.id}`;
  await startSession(sessionName, token, webhookUrl).catch(() => {});

  return NextResponse.json({ id: wppSession.id, sessionName, ok: true });
}
