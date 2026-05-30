import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getHistory, addMessage, getClientId, getAllConversationsByClientId, debugGetRawKeys } from "@/lib/conversations";
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
  const messages = getHistory(normalized);
  // debug: pega chaves brutas do arquivo sem filtro de clientId
  const rawKeys = debugGetRawKeys(30);
  const digits = normalized.startsWith("55") ? normalized.slice(2) : normalized;
  const matching = rawKeys.filter((k) => k.includes(digits));
  console.log(`[conversations/GET] phone=${normalized} found=${messages.length} matching=${JSON.stringify(matching)} sample=${JSON.stringify(rawKeys.slice(0, 5))}`);
  return NextResponse.json({ messages, _debug: { phone: normalized, digits, count: messages.length, matching, sampleKeys: rawKeys } });
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
    const ok = await wppSendText(wppSession.sessionName, wppSession.sessionToken, normalized, message.trim());
    console.log(`[conversations/send] WPPConnect ok=${ok} session=${wppSession.sessionName} phone=${normalized}`);
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
