import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getHistory, addMessage, getClientId } from "@/lib/conversations";
import { getLeadByPhone, upsertLeadByPhone } from "@/lib/leads";
import { getFunnelById } from "@/lib/funnels";
import { sendText } from "@/lib/uazapi";
import { getConfig, getClientById } from "@/lib/clients";

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
  let funnelId: string | undefined;
  if (clientId) {
    const lead = getLeadByPhone(clientId, normalized);
    funnelId = lead?.funnelId;
    if (funnelId) {
      const funnel = getFunnelById(funnelId);
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

  // Pausa a IA — mesma lógica do fromMe no webhook
  if (clientId) {
    const agCfg = getClientById(clientId)?.agentConfig;
    const resumeKeyword = agCfg?.aiResumeKeyword?.trim();
    if (resumeKeyword && message.trim().toLowerCase() === resumeKeyword.toLowerCase()) {
      upsertLeadByPhone(clientId, normalized, { funnelId, aiPaused: false });
    } else {
      upsertLeadByPhone(clientId, normalized, { funnelId, aiPaused: true });
    }
  }

  addMessage(normalized, { role: "assistant", content: message.trim(), ts: Date.now() }, clientId);

  return NextResponse.json({ ok: true });
}
