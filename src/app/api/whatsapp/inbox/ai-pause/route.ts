import { NextRequest, NextResponse } from "next/server";
import { setAiPaused } from "@/lib/conversations";
import { upsertLeadByPhone } from "@/lib/leads";

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
  setAiPaused(cleanPhone, paused);
  if (clientId) {
    upsertLeadByPhone(clientId, cleanPhone, { aiPaused: paused });
  }

  return NextResponse.json({ ok: true, aiPaused: paused });
}
