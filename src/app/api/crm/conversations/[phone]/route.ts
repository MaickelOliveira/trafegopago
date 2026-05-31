import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getHistory, addMessage, getClientId, getAllConversationsByClientId } from "@/lib/conversations";
import { markSent } from "@/lib/wppconnect-sent";
import { getLeadByPhone, upsertLeadByPhone } from "@/lib/leads";
import { getFunnelById } from "@/lib/funnels";
import { sendText } from "@/lib/uazapi";
import { sendText as wppSendText } from "@/lib/wppconnect-api";
import { getWppSessions } from "@/lib/wppconnect-sessions";
import { getConfig, getClientById } from "@/lib/clients";

type Params = Promise<{ phone: string }>;

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: Params }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { phone } = await params;
  const normalized = phone.replace(/\D/g, "");
  // Usa o clientId passado pelo LeadModal para buscar a conversa correta (chave prefixada clientId:phone)
  const clientId = req.nextUrl.searchParams.get("clientId") ?? undefined;
  const messages = getHistory(normalized, clientId);
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

  // Busca conexão do funil do lead
  let token: string | null = null;
  let funnelId: string | undefined;
  let metaPhoneNumberId: string | null = null;
  let metaToken: string | null = null;
  let connType: string = "uazapi";
  let wppSession: ReturnType<typeof getWppSessions>[number] | undefined;

  if (clientId) {
    const lead = getLeadByPhone(clientId, normalized);
    funnelId = lead?.funnelId;
    if (funnelId) {
      // Verifica WPPConnect primeiro (sessões ficam em store separado)
      wppSession = getWppSessions().find(s => s.funnelId === funnelId);
      if (!wppSession) {
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
  }
  if (!wppSession && connType !== "meta" && !token) {
    const config = getConfig();
    token = config.uazapiToken ?? null;
  }

  // Envia pela conexão correta
  if (wppSession) {
    const lead = clientId ? getLeadByPhone(clientId, normalized) : undefined;
    let isLid = lead?.isLid === true;
    markSent(normalized, message.trim()); // marca ANTES de enviar (evita race condition com onselfmessage)
    let ok = await wppSendText(wppSession.sessionName, wppSession.sessionToken, normalized, message.trim(), isLid);
    // Fallback: se falhou e não tentamos isLid ainda, tenta com isLid:true
    // (cobre leads criados antes da detecção automática de LID)
    if (!ok && !isLid) {
      console.log(`[conversations/send] Retrying with isLid=true phone=${normalized}`);
      ok = await wppSendText(wppSession.sessionName, wppSession.sessionToken, normalized, message.trim(), true);
      if (ok && clientId && funnelId) {
        // Salva isLid:true no lead para envios futuros
        upsertLeadByPhone(clientId, normalized, { funnelId, isLid: true });
        isLid = true;
      }
    }
    console.log(`[conversations/send] WPPConnect ok=${ok} session=${wppSession.sessionName} phone=${normalized} isLid=${isLid}`);
  } else if (connType === "meta" && metaPhoneNumberId && metaToken) {
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
