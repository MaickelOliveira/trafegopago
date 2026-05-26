import { NextRequest, NextResponse } from "next/server";
import { upsertLeadByPhone } from "@/lib/leads";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const { phone, clientId, paused } = await req.json() as {
    phone: string;
    clientId: string;
    paused: boolean;
  };

  if (!phone || !clientId) {
    return NextResponse.json({ error: "phone e clientId são obrigatórios" }, { status: 400 });
  }

  const cleanPhone = phone.replace(/\D/g, "");
  upsertLeadByPhone(clientId, cleanPhone, { aiPaused: paused });

  return NextResponse.json({ ok: true, aiPaused: paused });
}
