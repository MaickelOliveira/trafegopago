import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getHistory, addMessage, getClientId } from "@/lib/conversations";
import { sendWhatsApp } from "@/lib/whatsapp";

type Params = Promise<{ phone: string }>;

export async function GET(req: NextRequest, { params }: { params: Params }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { phone } = await params;
  const normalized = phone.replace(/\D/g, "");
  const messages = getHistory(normalized);
  return NextResponse.json({ messages });
}

export async function POST(req: NextRequest, { params }: { params: Params }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { phone } = await params;
  const normalized = phone.replace(/\D/g, "");

  const { message } = await req.json();
  if (!message?.trim()) return NextResponse.json({ error: "message obrigatório" }, { status: 400 });

  await sendWhatsApp(normalized, message.trim());

  const clientId = getClientId(normalized);
  addMessage(normalized, { role: "assistant", content: message.trim(), ts: Date.now() }, clientId);

  return NextResponse.json({ ok: true });
}
