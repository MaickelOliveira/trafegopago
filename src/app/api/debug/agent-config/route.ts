import { NextRequest, NextResponse } from "next/server";
import { getClientById, getAllAgentConfigs } from "@/lib/clients";
import { getFunnels } from "@/lib/funnels";

export const dynamic = "force-dynamic";

/** Lista, sem expor segredos, as configs relevantes de splitMessages/messageWaitSeconds por conexão. */
export async function GET(req: NextRequest) {
  const clientId = req.nextUrl.searchParams.get("clientId");
  if (!clientId) return NextResponse.json({ error: "clientId required" }, { status: 400 });

  const client = getClientById(clientId);
  if (!client) return NextResponse.json({ error: "client not found" }, { status: 404 });

  const funnels = getFunnels().filter((f) => f.clientId === clientId);
  const connections = funnels.flatMap((f) => f.connections ?? []).map((c) => ({
    id: c.id,
    type: c.type,
    phone: c.phone,
  }));

  const configs = getAllAgentConfigs(client).map((cfg) => ({
    name: cfg.name,
    whatsappConnectionId: cfg.whatsappConnectionId,
    enabled: cfg.enabled,
    splitMessages: cfg.splitMessages,
    maxMessageLength: cfg.maxMessageLength,
    messageWaitSeconds: cfg.messageWaitSeconds,
    followUpEnabled: cfg.followUpEnabled,
  }));

  return NextResponse.json({ clientId, connections, configs });
}
