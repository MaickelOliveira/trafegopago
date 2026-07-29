import { NextRequest, NextResponse } from "next/server";
import { getClientById, getAllAgentConfigs } from "@/lib/clients";
import { getAllConversationsByClientId } from "@/lib/conversations";
import { dateISOBrasilia, todayISOBrasilia, currentHHMMBrasilia } from "@/lib/timezone";

export const dynamic = "force-dynamic";

// Debug: dry-run da lógica de runDailySummaries() SEM enviar nada — mostra
// exatamente o que a função veria agora (conexão, destinatários, quantas
// conversas bateriam no filtro de "hoje"), pra diagnosticar por que o
// disparo real não chegou mesmo com o guard de "já enviado hoje" batendo.
export async function GET(req: NextRequest) {
  const clientId = req.nextUrl.searchParams.get("clientId");
  if (!clientId) return NextResponse.json({ error: "clientId obrigatório" }, { status: 400 });

  const client = getClientById(clientId);
  if (!client) return NextResponse.json({ error: "client not found" }, { status: 404 });

  const today = todayISOBrasilia();
  const nowHHMM = currentHHMMBrasilia();

  const configs = getAllAgentConfigs(client).map((cfg) => {
    const connId = cfg.whatsappConnectionId;
    const conversasHoje = getAllConversationsByClientId(client.id)
      .filter((c) => (connId ? c.connId === connId : true))
      .filter((c) => dateISOBrasilia(c.lastActivity) === today);

    const recipients = cfg.avisos?.length
      ? cfg.avisos
      : cfg.summaryPhone
        ? [{ id: "legacy", label: "Gestor", value: cfg.summaryPhone, type: "phone" as const }]
        : [];

    return {
      name: cfg.name,
      whatsappConnectionId: connId,
      dailySummaryEnabled: cfg.dailySummaryEnabled,
      dailySummaryTime: cfg.dailySummaryTime,
      dailySummaryLastSentDate: cfg.dailySummaryLastSentDate,
      conversasHojeCount: conversasHoje.length,
      recipients: recipients.map((r) => ({ label: r.label, type: r.type, value: r.value })),
    };
  });

  return NextResponse.json({ clientId, today, nowHHMM, configs });
}
