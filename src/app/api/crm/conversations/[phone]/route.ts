import { NextRequest, NextResponse } from "next/server";
import { readFileSync, existsSync, writeFileSync } from "fs";
import path from "path";
import { getSession } from "@/lib/auth";
import { getHistory, addMessage, getClientId, getAllConversationsByClientId } from "@/lib/conversations";
import { markSent, markPhoneSending } from "@/lib/wppconnect-sent";
import { getLeadByPhone, upsertLeadByPhone } from "@/lib/leads";
import { cancelPendingForPhone } from "@/lib/pending-responses";
import { getFunnelById, getFunnels } from "@/lib/funnels";
import { sendText, sendMedia as uazapiSendMedia } from "@/lib/uazapi";
import { sendText as wppSendText, sendMedia as wppSendMedia } from "@/lib/wppconnect-api";
import { getWppSessions } from "@/lib/wppconnect-sessions";
import { sendText as evoSendText, sendMedia as evoSendMedia } from "@/lib/evolution-api";
import { getEvolutionSessions } from "@/lib/evolution-sessions";
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
  const explicitConnId = req.nextUrl.searchParams.get("connId") ?? undefined;

  // Número escolhido explicitamente pelo operador no seletor — busca o
  // histórico isolado dessa conexão. Usa o mesmo casamento fuzzy de telefone
  // do fallback abaixo (não só a chave exata clientId:connId:phone) porque o
  // connId "ao vivo" (da lista de conexões atual) pode não bater 1:1 com o
  // connId gravado na conversa quando a conexão foi reconfigurada/duplicada.
  if (explicitConnId) {
    if (clientId) {
      const tail9 = normalized.slice(-9);
      const matched = getAllConversationsByClientId(clientId)
        .filter((c) => c.connId === explicitConnId)
        .filter((c) => {
          const d = c.phone.replace(/\D/g, "");
          return d === normalized || d.endsWith(tail9) || normalized.endsWith(d.slice(-9));
        })
        .sort((a, b) => b.lastActivity - a.lastActivity);
      for (const conv of matched) {
        const msgs = getHistory(conv.phone, clientId, explicitConnId);
        if (msgs.length > 0) return NextResponse.json({ messages: msgs, connId: explicitConnId });
      }
    }
    // Sem correspondência fuzzy: tenta a chave direta mesmo assim (rede de segurança)
    const msgs = getHistory(normalized, clientId, explicitConnId);
    return NextResponse.json({ messages: msgs, connId: explicitConnId });
  }

  // Resolve connId do funil do lead (tentativa primária)
  let connId: string | undefined;
  if (funnelId) {
    const wppSession = getWppSessions().find((s) => s.funnelId === funnelId);
    const evoSession = !wppSession ? getEvolutionSessions().find((s) => s.funnelId === funnelId) : undefined;
    if (wppSession) {
      connId = wppSession.id;
    } else if (evoSession) {
      connId = evoSession.id;
    } else {
      const funnel = getFunnelById(funnelId);
      connId = funnel?.connections?.find((c) => c.type === "uazapi")?.id
        ?? funnel?.connections?.[0]?.id;
    }
  }

  // Tenta com o connId do funil do lead
  if (connId) {
    const msgs = getHistory(normalized, clientId, connId);
    if (msgs.length > 0) return NextResponse.json({ messages: msgs, connId });
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
      if (msgs.length > 0) return NextResponse.json({ messages: msgs, connId: conv.connId ?? null });
    }
  }

  // Último recurso: chave legada sem connId
  const messages = getHistory(normalized, clientId);
  return NextResponse.json({ messages, connId: null });
}

export async function POST(req: NextRequest, { params }: { params: Params }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { phone } = await params;
  const normalized = phone.replace(/\D/g, "");

  const { message, imageUrl, clientId: bodyClientId, funnelId: bodyFunnelId, connId: explicitConnId } = await req.json() as {
    message?: string;
    imageUrl?: string;
    clientId?: string;
    funnelId?: string;
    connId?: string;
  };
  if (!message?.trim() && !imageUrl?.trim()) return NextResponse.json({ error: "message ou imageUrl obrigatório" }, { status: 400 });

  // Prefere o clientId/funnelId do lead enviados pelo front-end: getClientId()
  // resolve pelo telefone e pode escolher o cliente errado quando o mesmo número
  // tem conversas em mais de um cliente (ex: número usado para testes).
  const clientId = bodyClientId ?? getClientId(normalized);

  // Busca conexão do funil do lead
  let token: string | null = null;
  let funnelId: string | undefined;
  let metaPhoneNumberId: string | null = null;
  let metaToken: string | null = null;
  let connType: string = "uazapi";
  let wppSession: ReturnType<typeof getWppSessions>[number] | undefined;
  let evoSession: ReturnType<typeof getEvolutionSessions>[number] | undefined;
  let connId: string | undefined;

  if (clientId) {
    const lead = getLeadByPhone(clientId, normalized);
    funnelId = bodyFunnelId ?? lead?.funnelId;
    const allFunnels = getFunnels().filter((f) => f.clientId === clientId);

    // Número escolhido explicitamente pelo operador no seletor — usa exatamente
    // essa conexão, sem cair nas heurísticas de "conversa mais recente"/funil abaixo.
    if (explicitConnId) {
      const wpp = getWppSessions().find((s) => s.id === explicitConnId);
      const evo = !wpp ? getEvolutionSessions().find((s) => s.id === explicitConnId) : undefined;
      if (wpp) {
        wppSession = wpp; connId = wpp.id;
      } else if (evo) {
        evoSession = evo; connId = evo.id;
      } else {
        const conn = allFunnels.flatMap((f) => f.connections ?? []).find((c) => c.id === explicitConnId);
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

    // 1ª tentativa: usa a MESMA conexão da conversa mais recente deste telefone —
    // é a conexão que de fato já trocou mensagens com o lead (histórico e token
    // corretos), evitando enviar/salvar por uma conexão duplicada/desativada.
    if (!wppSession && !evoSession && !connId) {
      const tail9 = normalized.slice(-9);
      const matched = getAllConversationsByClientId(clientId)
        .filter((c) => {
          const d = c.phone.replace(/\D/g, "");
          return d === normalized || d.endsWith(tail9) || normalized.endsWith(d.slice(-9));
        })
        .sort((a, b) => b.lastActivity - a.lastActivity);

      for (const conv of matched) {
        if (!conv.connId) continue;
        const wpp = getWppSessions().find((s) => s.id === conv.connId);
        if (wpp) { wppSession = wpp; connId = wpp.id; break; }
        const evo = getEvolutionSessions().find((s) => s.id === conv.connId);
        if (evo) { evoSession = evo; connId = evo.id; break; }
        const conn = allFunnels.flatMap((f) => f.connections ?? []).find((c) => c.id === conv.connId);
        if (conn && ((conn.type === "meta" && conn.metaPhoneNumberId && conn.metaToken) || (conn.type === "uazapi" && conn.uazapiToken))) {
          connId = conn.id;
          connType = conn.type ?? "uazapi";
          if (conn.type === "meta") {
            metaPhoneNumberId = conn.metaPhoneNumberId ?? null;
            metaToken = conn.metaToken ?? null;
          } else {
            token = conn.uazapiToken ?? null;
          }
          break;
        }
      }
    }

    // 2ª tentativa (fallback original): conexão do funil do lead
    if (!wppSession && !evoSession && !connId && funnelId) {
      // Verifica WPPConnect e Evolution primeiro (sessões ficam em store separado)
      wppSession = getWppSessions().find(s => s.funnelId === funnelId);
      if (wppSession) {
        connId = wppSession.id;
      } else {
        evoSession = getEvolutionSessions().find(s => s.funnelId === funnelId);
        if (evoSession) {
          connId = evoSession.id;
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
  }
  if (!wppSession && !evoSession && connType !== "meta" && !token) {
    const config = getConfig();
    token = config.uazapiToken ?? null;
  }

  const msgText = message?.trim() ?? "";
  const imgUrl = imageUrl?.trim() ?? "";

  let ok = false;
  let errorMsg: string | undefined;

  // Envia pela conexão correta
  if (wppSession) {
    const lead = clientId ? getLeadByPhone(clientId, normalized) : undefined;
    let isLid = lead?.isLid === true;

    if (imgUrl) {
      // Envia imagem com legenda — marca antes para que o eco fromMe não pause a IA
      markPhoneSending(normalized);
      ok = await wppSendMedia(wppSession.sessionName, wppSession.sessionToken, normalized, imgUrl, msgText || undefined, isLid);
    } else if (msgText) {
      // Só texto
      markSent(normalized, msgText);
      ok = await wppSendText(wppSession.sessionName, wppSession.sessionToken, normalized, msgText, isLid);
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
    if (!ok) errorMsg = "Falha ao enviar via WPPConnect (sessão desconectada — escaneie o QR Code novamente)";
  } else if (evoSession) {
    const lead = clientId ? getLeadByPhone(clientId, normalized) : undefined;
    let isLid = lead?.isLid === true;

    if (imgUrl) {
      markPhoneSending(normalized);
      ok = await evoSendMedia(evoSession.instanceName, evoSession.instanceApiKey, normalized, imgUrl, msgText || undefined, isLid);
    } else if (msgText) {
      markSent(normalized, msgText);
      ok = await evoSendText(evoSession.instanceName, evoSession.instanceApiKey, normalized, msgText, isLid);
      if (!ok && !isLid) {
        console.log(`[conversations/send] Retrying with isLid=true phone=${normalized}`);
        ok = await evoSendText(evoSession.instanceName, evoSession.instanceApiKey, normalized, msgText, true);
        if (ok && clientId && funnelId) {
          upsertLeadByPhone(clientId, normalized, { funnelId, isLid: true });
          isLid = true;
        }
      }
      console.log(`[conversations/send] Evolution ok=${ok} instance=${evoSession.instanceName} phone=${normalized} isLid=${isLid}`);
    }
    if (!ok) errorMsg = "Falha ao enviar via Evolution API (instância desconectada — escaneie o QR Code novamente)";
  } else if (connType === "meta" && metaPhoneNumberId && metaToken) {
    if (msgText) {
      const res = await fetch(`https://graph.facebook.com/v19.0/${metaPhoneNumberId}/messages`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${metaToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: normalized,
          type: "text",
          text: { body: msgText },
        }),
      }).catch((e) => { console.error("[conversations/send] Meta API error:", e); return null; });
      const bodyText = await res?.text().catch(() => "") ?? "";
      let data: { error?: { message?: string; code?: number } } | null = null;
      try { data = bodyText ? JSON.parse(bodyText) : null; } catch { /* corpo não-JSON */ }
      // Mesmo com status 2xx, a Graph API pode retornar um objeto "error" no corpo
      // (ex: janela de 24h fechada) — sem checar isso, marcávamos como enviado indevidamente.
      ok = res?.ok === true && !data?.error;

      // ── DEBUG: captura a resposta da Graph API para diagnosticar envios "fantasma" ──
      try {
        const debugFile = path.join(process.cwd(), "data", "debug-meta-send.json");
        const existing: unknown[] = existsSync(debugFile)
          ? (JSON.parse(readFileSync(debugFile, "utf-8")) as unknown[])
          : [];
        existing.unshift({
          ts: new Date().toISOString(),
          phoneNumberId: metaPhoneNumberId,
          to: normalized,
          status: res?.status ?? null,
          ok,
          body: bodyText.slice(0, 500),
        });
        if (existing.length > 20) existing.length = 20;
        writeFileSync(debugFile, JSON.stringify(existing, null, 2));
      } catch { /* debug only */ }

      if (!ok) {
        console.error(`[conversations/send] Meta API falhou status=${res?.status} phoneNumberId=${metaPhoneNumberId} body=${bodyText.slice(0, 300)}`);
        errorMsg = data?.error?.message
          ? `Falha ao enviar via Meta API: ${data.error.message}`
          : "Falha ao enviar via Meta API (token de acesso desta conexão pode estar expirado/inválido)";
      }
    }
  } else if (token) {
    if (imgUrl) {
      ok = await uazapiSendMedia(token, normalized, "image", imgUrl, msgText || undefined);
    } else if (msgText) {
      ok = await sendText(token, normalized, msgText);
    }
    if (!ok) errorMsg = "Falha ao enviar via UazAPI (instância desconectada?)";
  } else {
    console.warn("[conversations/send] sem token para enviar ao phone:", normalized);
    errorMsg = "Nenhuma conexão de WhatsApp configurada para este lead";
  }

  // Pausa a IA — mesma lógica do fromMe no webhook
  if (clientId && ok) {
    const agCfg = getClientById(clientId)?.agentConfig;
    const resumeKeyword = agCfg?.aiResumeKeyword?.trim();
    if (resumeKeyword && msgText.toLowerCase() === resumeKeyword.toLowerCase()) {
      upsertLeadByPhone(clientId, normalized, { funnelId, aiPaused: false });
    } else {
      upsertLeadByPhone(clientId, normalized, { funnelId, aiPaused: true });
      // Cancela qualquer ciclo de resposta da IA já agendado para este telefone —
      // sem isso, um batch em "pending" no momento do envio manual do gestor ainda
      // dispararia e mandaria a resposta da IA por cima da mensagem dele.
      cancelPendingForPhone(clientId, normalized);
    }
  }

  if (ok) {
    const savedContent = imgUrl ? (msgText ? `[imagem] ${msgText}` : "[imagem]") : msgText;
    if (savedContent) addMessage(normalized, { role: "assistant", content: savedContent, ts: Date.now() }, clientId, connId ? { connId } : undefined);
  }

  return NextResponse.json({ ok, error: ok ? undefined : errorMsg });
}
