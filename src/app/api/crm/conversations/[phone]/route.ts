import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getHistory, addMessage, getClientId, getAllConversationsByClientId } from "@/lib/conversations";
import { markSent, markPhoneSending } from "@/lib/wppconnect-sent";
import { getLeadByPhone, upsertLeadByPhone } from "@/lib/leads";
import { getFunnelById } from "@/lib/funnels";
import { sendText, sendMedia as uazapiSendMedia } from "@/lib/uazapi";
import { sendText as wppSendText, sendMedia as wppSendMedia } from "@/lib/wppconnect-api";
import { getWppSessions } from "@/lib/wppconnect-sessions";
import { getConfig, getClientById } from "@/lib/clients";

type Params = Promise<{ phone: string }>;

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: Params }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { phone } = await params;
  const normalized = phone.replace(/\D/g, "");
  const clientId = req.nextUrl.searchParams.get("clientId") ?? undefined;
  const funnelId = req.nextUrl.searchParams.get("funnelId") ?? undefined;

  // Resolve connId do funil do lead (tentativa primária)
  let connId: string | undefined;
  if (funnelId) {
    const wppSession = getWppSessions().find((s) => s.funnelId === funnelId);
    if (wppSession) {
      connId = wppSession.id;
    } else {
      const funnel = getFunnelById(funnelId);
      connId = funnel?.connections?.find((c) => c.type === "uazapi")?.id
        ?? funnel?.connections?.[0]?.id;
    }
  }

  // Tenta com o connId do funil do lead
  if (connId) {
    const msgs = getHistory(normalized, clientId, connId);
    if (msgs.length > 0) return NextResponse.json({ messages: msgs });
  }

  // Fallback: busca a conversa mais recente para este telefone em QUALQUER conexão.
  // Necessário quando o lead está em um funil diferente do que recebeu a mensagem.
  if (clientId) {
    const allConvs = getAllConversationsByClientId(clientId);
    const tail9 = normalized.slice(-9); // últimos 9 dígitos para comparação fuzzy
    const matched = allConvs
      .filter((c) => {
        const d = c.phone.replace(/\D/g, "");
        return d === normalized || d.endsWith(tail9) || normalized.endsWith(d.slice(-9));
      })
      .sort((a, b) => b.lastActivity - a.lastActivity);

    for (const conv of matched) {
      const msgs = getHistory(conv.phone, clientId, conv.connId ?? undefined);
      if (msgs.length > 0) return NextResponse.json({ messages: msgs });
    }
  }

  // Último recurso: chave legada sem connId
  const messages = getHistory(normalized, clientId);
  return NextResponse.json({ messages });
}

export async function POST(req: NextRequest, { params }: { params: Params }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { phone } = await params;
  const normalized = phone.replace(/\D/g, "");

  const { message, imageUrl } = await req.json() as { message?: string; imageUrl?: string };
  if (!message?.trim() && !imageUrl?.trim()) return NextResponse.json({ error: "message ou imageUrl obrigatório" }, { status: 400 });

  const clientId = getClientId(normalized);

  // Busca conexão do funil do lead
  let token: string | null = null;
  let funnelId: string | undefined;
  let metaPhoneNumberId: string | null = null;
  let metaToken: string | null = null;
  let connType: string = "uazapi";
  let wppSession: ReturnType<typeof getWppSessions>[number] | undefined;
  let connId: string | undefined;

  if (clientId) {
    const lead = getLeadByPhone(clientId, normalized);
    funnelId = lead?.funnelId;
    if (funnelId) {
      // Verifica WPPConnect primeiro (sessões ficam em store separado)
      wppSession = getWppSessions().find(s => s.funnelId === funnelId);
      if (wppSession) {
        connId = wppSession.id;
      } else {
        const funnel = getFunnelById(funnelId);
        // Prefere conexão uazapi (mesma ordem do webhook), fallback para a primeira
        const conn = funnel?.connections?.find((c) => c.type === "uazapi")
          ?? funnel?.connections?.[0];
        if (conn) {
          connId = conn.id;
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

  const msgText = message?.trim() ?? "";
  const imgUrl = imageUrl?.trim() ?? "";

  // Envia pela conexão correta
  if (wppSession) {
    const lead = clientId ? getLeadByPhone(clientId, normalized) : undefined;
    let isLid = lead?.isLid === true;

    if (imgUrl) {
      // Envia imagem com legenda — marca antes para que o eco fromMe não pause a IA
      markPhoneSending(normalized);
      await wppSendMedia(wppSession.sessionName, wppSession.sessionToken, normalized, imgUrl, msgText || undefined, isLid);
    }
    if (msgText && !imgUrl) {
      // Só texto
      markSent(normalized, msgText);
      let ok = await wppSendText(wppSession.sessionName, wppSession.sessionToken, normalized, msgText, isLid);
      if (!ok && !isLid) {
        console.log(`[conversations/send] Retrying with isLid=true phone=${normalized}`);
        ok = await wppSendText(wppSession.sessionName, wppSession.sessionToken, normalized, msgText, true);
        if (ok && clientId && funnelId) {
          upsertLeadByPhone(clientId, normalized, { funnelId, isLid: true });
          isLid = true;
        }
      }
      console.log(`[conversations/send] WPPConnect ok=${ok} session=${wppSession.sessionName} phone=${normalized} isLid=${isLid}`);
    }
  } else if (connType === "meta" && metaPhoneNumberId && metaToken) {
    if (msgText) {
      await fetch(`https://graph.facebook.com/v19.0/${metaPhoneNumberId}/messages`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${metaToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: normalized,
          type: "text",
          text: { body: msgText },
        }),
      }).catch(e => console.error("[conversations/send] Meta API error:", e));
    }
  } else if (token) {
    if (imgUrl) {
      await uazapiSendMedia(token, normalized, "image", imgUrl, msgText || undefined);
    } else if (msgText) {
      await sendText(token, normalized, msgText);
    }
  } else {
    console.warn("[conversations/send] sem token para enviar ao phone:", normalized);
  }

  // Pausa a IA — mesma lógica do fromMe no webhook
  if (clientId) {
    const agCfg = getClientById(clientId)?.agentConfig;
    const resumeKeyword = agCfg?.aiResumeKeyword?.trim();
    if (resumeKeyword && msgText.toLowerCase() === resumeKeyword.toLowerCase()) {
      upsertLeadByPhone(clientId, normalized, { funnelId, aiPaused: false });
    } else {
      upsertLeadByPhone(clientId, normalized, { funnelId, aiPaused: true });
    }
  }

  const savedContent = imgUrl ? (msgText ? `[imagem] ${msgText}` : "[imagem]") : msgText;
  if (savedContent) addMessage(normalized, { role: "assistant", content: savedContent, ts: Date.now() }, clientId, connId ? { connId } : undefined);

  return NextResponse.json({ ok: true });
}
