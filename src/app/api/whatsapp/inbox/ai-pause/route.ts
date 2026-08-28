import { NextRequest, NextResponse } from "next/server";
import { setAiPaused } from "@/lib/conversations";
import { getLeadByPhone, updateLead } from "@/lib/leads";
import { cancelFollowUpsForPhone } from "@/lib/followups";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const { phone, clientId, paused } = await req.json() as {
    phone: string;
    clientId: string;
    paused: boolean;
  };

  if (!phone) {
    return NextResponse.json({ error: "phone é obrigatório" }, { status: 400 });
  }

  const cleanPhone = phone.replace(/\D/g, "");
  // Atualiza os dois storages em sincronia
  setAiPaused(cleanPhone, paused, clientId);
  if (clientId) {
    const existingLead = getLeadByPhone(clientId, cleanPhone);
    if (existingLead) updateLead(existingLead.id, { aiPaused: paused });
    // Ao pausar, cancela follow-ups automáticos pendentes — senão um follow-up
    // já agendado antes dessa pausa dispara depois e reativa a IA sozinho
    // (mesmo problema corrigido em /api/whatsapp/inbox/send/route.ts).
    if (paused) cancelFollowUpsForPhone(clientId, cleanPhone);
  }

  return NextResponse.json({ ok: true, aiPaused: paused });
}
