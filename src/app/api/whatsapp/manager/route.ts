import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getConfig, getClients } from "@/lib/clients";
import { getFunnels, updateFunnel } from "@/lib/funnels";
import { listInstances, createInstance, setWebhook, updateFieldsMap } from "@/lib/uazapi";

export type EnrichedInstance = {
  token: string;
  name: string;
  status: string;
  phone: string | null;
  // CRM link
  linkedFunnelId: string | null;
  linkedFunnelName: string | null;
  linkedClientId: string | null;
  linkedClientName: string | null;
  // AI agent
  hasAgentLinked: boolean;
  agentEnabled: boolean;
  // Webhook
  webhookConfigured: boolean;
  appWebhookUrl: string;
};

export async function GET() {
  const session = await getSession();
  if (!session || session.role !== "manager") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const config = getConfig();
  const appWebhookUrl = `${config.appBaseUrl ?? ""}/api/whatsapp/webhook`;

  // 1. Fetch raw instances from UazAPI
  const rawInstances = await listInstances() as Record<string, unknown>[];

  // 2. Build lookup: uazapiToken → funnel info
  const funnels = getFunnels();
  const tokenToFunnel = new Map<string, { funnelId: string; funnelName: string; connId: string; clientId: string | null }>();
  for (const funnel of funnels) {
    for (const conn of funnel.connections ?? []) {
      if (conn.type === "uazapi" && conn.uazapiToken) {
        tokenToFunnel.set(conn.uazapiToken, {
          funnelId: funnel.id,
          funnelName: funnel.name,
          connId: conn.id,
          clientId: funnel.clientId ?? null,
        });
      }
    }
  }

  // 3. Build lookup: whatsappConnectionId → client info
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

  // 4. Enrich instances
  const enriched: EnrichedInstance[] = rawInstances.map((raw) => {
    const inst = (raw.instance ?? raw) as Record<string, unknown>;
    const token = (inst.token ?? raw.token ?? "") as string;
    const name = (inst.name ?? raw.name ?? "") as string;
    const connected = raw.connected === true || inst.status === "connected" || inst.state === "open";
    const status = connected ? "connected" : ((inst.status ?? inst.state ?? "disconnected") as string);
    const phone = ((inst.owner ?? inst.phone ?? inst.number ?? inst.jid ?? "") as string).replace(/\D/g, "") || null;

    const funnelInfo = tokenToFunnel.get(token) ?? null;
    const clientInfo = funnelInfo?.connId ? connIdToClient.get(funnelInfo.connId) ?? null : null;

    // Check by name as fallback (sometimes token differs between list and connection)
    const funnelInfoByName = !funnelInfo ? (() => {
      for (const funnel of funnels) {
        const conn = funnel.connections?.find(c => c.type === "uazapi" && c.id === name);
        if (conn) return { funnelId: funnel.id, funnelName: funnel.name, connId: conn.id, clientId: funnel.clientId ?? null };
      }
      return null;
    })() : null;

    const effectiveFunnel = funnelInfo ?? funnelInfoByName;
    const effectiveClient = clientInfo ?? (effectiveFunnel?.connId ? connIdToClient.get(effectiveFunnel.connId) ?? null : null);

    // Resolve client name
    const linkedClientId = effectiveFunnel?.clientId ?? effectiveClient?.clientId ?? null;
    const linkedClientName = linkedClientId ? (clients.find(c => c.id === linkedClientId)?.name ?? null) : null;

    return {
      token,
      name,
      status,
      phone,
      linkedFunnelId: effectiveFunnel?.funnelId ?? null,
      linkedFunnelName: effectiveFunnel?.funnelName ?? null,
      linkedClientId,
      linkedClientName,
      hasAgentLinked: !!effectiveClient,
      agentEnabled: effectiveClient?.agentEnabled ?? false,
      webhookConfigured: !!effectiveFunnel,
      appWebhookUrl,
    };
  });

  return NextResponse.json(enriched);
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "manager") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { name } = await req.json() as { name: string };
  if (!name?.trim()) {
    return NextResponse.json({ error: "Nome obrigatório" }, { status: 400 });
  }

  const instanceName = name.trim().toLowerCase().replace(/\s+/g, "-");
  const config = getConfig();
  const appWebhookUrl = `${config.appBaseUrl ?? ""}/api/whatsapp/webhook`;

  const created = await createInstance(instanceName);
  const token = (created.token as string) || (created.instanceToken as string) || (config.uazapiToken ?? "");

  if (!token) {
    return NextResponse.json({ error: "Falha ao criar instância no UazAPI" }, { status: 500 });
  }

  // Configure webhook and field map immediately
  setWebhook(token, appWebhookUrl).catch(() => {});
  updateFieldsMap(token).catch(() => {});

  return NextResponse.json({ token, name: instanceName, ok: true });
}
