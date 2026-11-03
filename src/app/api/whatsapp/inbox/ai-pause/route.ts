import { getLeadForConnection } from "@/lib/lead-context";
import { NextRequest, NextResponse } from "next/server";
import { setAiPaused } from "@/lib/conversations";
import { getLeadByPhone, updateLead } from "@/lib/leads";
import { cancelFollowUpsForPhone } from "@/lib/followups";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const { phone, clientId, paused, connId } = await req.json() as {
    phone: string;
    clientId: string;
    paused: boolean;
    connId?: string;
  };

  if (typeof phone !== "string" || typeof clientId !== "string" || typeof paused !== "boolean") {
    return NextResponse.json({ error: "phone é obrigatório" }, { status: 400 });
  }

  const cleanPhone = phone.replace(/\D/g, "");
  // Atualiza os dois storages em sincronia
  (await setAiPaused(cleanPhone, paused, clientId, connId));
  if (clientId) {
    const existingLead = (await getLeadForConnection(clientId, cleanPhone, connId));
    if (existingLead) (await updateLead(existingLead.id, { aiPaused: paused }));
    // Ao pausar, cancela follow-ups automáticos pendentes — senão um follow-up
    // já agendado antes dessa pausa dispara depois e reativa a IA sozinho
    // (mesmo problema corrigido em /api/whatsapp/inbox/send/route.ts).
    if (paused) (await cancelFollowUpsForPhone(clientId, cleanPhone, connId));
  }

  return NextResponse.json({ ok: true, aiPaused: paused });
}
