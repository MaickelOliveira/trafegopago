import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getHistory, addMessage, getClientId } from "@/lib/conversations";
import { getLeadByPhone } from "@/lib/leads";
import { getFunnelById } from "@/lib/funnels";
import { sendText } from "@/lib/uazapi";
import { getConfig } from "@/lib/clients";

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

  const clientId = getClientId(normalized);

  // Busca token da instância do funil do lead para enviar pela instância correta
  let token: string | null = null;
  if (clientId) {
    const lead = getLeadByPhone(clientId, normalized);
    if (lead?.funnelId) {
      const funnel = getFunnelById(lead.funnelId);
      const conn = funnel?.connections?.[0];
      token = conn?.uazapiToken ?? null;
    }
  }
  if (!token) {
    const config = getConfig();
    token = config.uazapiToken ?? null;
  }

  if (token) {
    await sendText(token, normalized, message.trim());
  } else {
    console.warn("[conversations/send] sem token para enviar ao phone:", normalized);
  }

  addMessage(normalized, { role: "assistant", content: message.trim(), ts: Date.now() }, clientId);

  return NextResponse.json({ ok: true });
}
