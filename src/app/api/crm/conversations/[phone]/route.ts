import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getHistory, addMessage, getClientId, getAllConversationsByClientId } from "@/lib/conversations";
import { getLeadByPhone, upsertLeadByPhone } from "@/lib/leads";
import { getFunnelById } from "@/lib/funnels";
import { sendText } from "@/lib/uazapi";
import { getConfig, getClientById } from "@/lib/clients";

type Params = Promise<{ phone: string }>;

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: Params }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { phone } = await params;
  const normalized = phone.replace(/\D/g, "");
  const messages = getHistory(normalized);
  // debug temporário — lista chaves existentes para o clientId deste lead
  const clientId = getClientId(normalized);
  const allConvs = clientId ? getAllConversationsByClientId(clientId).map((c) => c.phone) : [];
  console.log(`[conversations/GET] phone=${normalized} clientId=${clientId} found=${messages.length} allKeys=${JSON.stringify(allConvs.slice(0, 10))}`);
  return NextResponse.json({ messages, _debug: { phone: normalized, count: messages.length, clientId, allPhones: allConvs.slice(0, 20) } });
}

export async function POST(req: NextRequest, { params }: { params: Params }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { phone } = await params;
  const normalized = phone.replace(/\D/g, "");

  const { message } = await req.json();
  if (!message?.trim()) return NextResponse.json({ error: "message obrigatório" }, { status: 400 });

  const clientId = getClientId(normalized);

  // Busca conexão do funil do lead
  let token: string | null = null;
  let funnelId: string | undefined;
  let metaPhoneNumberId: string | null = null;
  let metaToken: string | null = null;
  let connType: string = "uazapi";

  if (clientId) {
    const lead = getLeadByPhone(clientId, normalized);
    funnelId = lead?.funnelId;
    if (funnelId) {
      const funnel = getFunnelById(funnelId);
      const conn = funnel?.connections?.[0];
      if (conn) {
        connType = conn.type ?? "uazapi";
        if (conn.type === "meta") {
          metaPhoneNumberId = conn.metaPhoneNumberId ?? null;
          metaToken = conn.metaToken ?? null;
        } else {
          token = conn.uazapiToken ?? null;
        }
      }
    }
  }
  if (connType !== "meta" && !token) {
    const config = getConfig();
    token = config.uazapiToken ?? null;
  }

  // Envia pela conexão correta
  if (connType === "meta" && metaPhoneNumberId && metaToken) {
    await fetch(`https://graph.facebook.com/v19.0/${metaPhoneNumberId}/messages`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${metaToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: normalized,
        type: "text",
        text: { body: message.trim() },
      }),
    }).catch(e => console.error("[conversations/send] Meta API error:", e));
  } else if (token) {
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
