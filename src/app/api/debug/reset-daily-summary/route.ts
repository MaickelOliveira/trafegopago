import { NextRequest, NextResponse } from "next/server";
import { getClientById, getAllAgentConfigs, upsertAgentConfigForConnection } from "@/lib/clients";

export const dynamic = "force-dynamic";

// Debug: limpa dailySummaryLastSentDate de um agentConfig — usado só pra
// permitir testar o resumo diário de novo no mesmo dia sem esperar até
// amanhã (o guard de "uma vez por dia" é intencional em produção normal).
export async function GET(req: NextRequest) {
  const clientId = req.nextUrl.searchParams.get("clientId");
  const connId = req.nextUrl.searchParams.get("connId");
  if (!clientId) return NextResponse.json({ error: "clientId obrigatório" }, { status: 400 });

  const client = getClientById(clientId);
  if (!client) return NextResponse.json({ error: "client not found" }, { status: 404 });

  const configs = getAllAgentConfigs(client);
  const target = connId
    ? configs.find((c) => c.whatsappConnectionId === connId)
    : configs.find((c) => c.dailySummaryLastSentDate);

  if (!target) return NextResponse.json({ error: "agentConfig não encontrado" }, { status: 404 });

  upsertAgentConfigForConnection(client, target.whatsappConnectionId ?? null, {
    ...target,
    dailySummaryLastSentDate: undefined,
  });

  return NextResponse.json({ ok: true, clientId, whatsappConnectionId: target.whatsappConnectionId });
}
