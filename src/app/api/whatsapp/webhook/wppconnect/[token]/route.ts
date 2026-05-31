import { NextRequest, NextResponse } from "next/server";
import { getWppSessionById } from "@/lib/wppconnect-sessions";
import { getFunnels } from "@/lib/funnels";
import { getLeads, getLeadByPhone, upsertLeadByPhone, updateLead, deleteLead } from "@/lib/leads";
import { getConfig, getClientById, getAgentConfigForConnection } from "@/lib/clients";
import { getAdInfoById } from "@/lib/meta-api";
import { getHistory, addMessage, setAiPaused, sanitizeContactName } from "@/lib/conversations";
import { markSent, consumeSent } from "@/lib/wppconnect-sent";
import { splitMessage } from "@/lib/uazapi";
import { runGeminiAgent } from "@/lib/gemini-agent";
import { processKanbanActions } from "@/lib/kanban-agent";
import { sendText as wppSendText, resolveContactPhone } from "@/lib/wppconnect-api";
import {
  upsertPending,
  getPendingForPhone,
  markProcessing,
  markDone,
  cancelPendingForPhone,
} from "@/lib/pending-responses";

export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;

  // Identifica a sessão pelo UUID
  const wppSession = getWppSessionById(token);
  if (!wppSession || !wppSession.funnelId) {
    console.log(`[WPPConnect Webhook] token=${token} ignorado (sessão sem funil ou inexistente)`);
    return NextResponse.json({ ok: true }); // ignora sessões sem funil
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json() as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: true });
  }

  console.log(`[WPPConnect Webhook] session=${wppSession.sessionName} event=${body.event} from=${body.from} fromMe=${body.fromMe} chatId=${body.chatId}`);

  // WPPConnect envia event = "onmessage" (incoming) ou "onselfmessage" (fromMe) ou outros
  const event = (body.event as string ?? "").toLowerCase();
  if (event !== "onmessage" && event !== "onanymessage" && event !== "message" && event !== "onselfmessage") {
    // Log de eventos filtrados para diagnóstico (inclui fromMe e outros)
    if (event) {
      console.log(`[WPPConnect Webhook] evento filtrado: event=${event} from=${body.from} fromMe=${body.fromMe} chatId=${body.chatId}`);
    }
    return NextResponse.json({ ok: true });
  }

  // WPPConnect espalha os campos da mensagem diretamente no body
  // (NÃO há um campo body.data — os campos ficam no nível raiz)
  const fromMe = body.fromMe === true || body.self === "out";

  // Ignora grupos
  const isGroupMsg = body.isGroupMsg === true || String(body.from ?? "").endsWith("@g.us");
  if (isGroupMsg) return NextResponse.json({ ok: true });

  // DEBUG: quando o from tem @lid (contato com LID do WhatsApp), loga o corpo completo
  if (String(body.from ?? "").endsWith("@lid")) {
    const senderDebug = body.sender as Record<string, unknown> | undefined;
    console.log(`[WPPConnect Webhook LID] BODY_KEYS=${JSON.stringify(Object.keys(body))}`);
    console.log(`[WPPConnect Webhook LID] from=${body.from} chatId=${body.chatId} author=${body.author} notifyName=${body.notifyName}`);
    console.log(`[WPPConnect Webhook LID] sender=${JSON.stringify(senderDebug)}`);
    console.log(`[WPPConnect Webhook LID] contact=${JSON.stringify(body.contact)}`);
  }

  // Extrai o número do remetente
  // Para fromMe=true (mensagem enviada por nós): usa chatId (o contato) em vez de sender (nós mesmos)
  // Para fromMe=false (mensagem recebida): usa sender.number; se LID → usa senderIdObj.user
  const sender = body.sender as Record<string, unknown> | undefined;
  const senderIdObj = sender?.id as Record<string, unknown> | undefined;

  const rawFrom = fromMe
    ? // Mensagem enviada por nós → pega o número do destinatário (chatId)
      (body.chatId as string) ||
      (body.to as string) ||
      (body.from as string) ||
      ""
    : // Mensagem recebida → pega o número do remetente
      (sender?.number as string) ||                       // número real (mais confiável)
      (senderIdObj?.user as string) ||                    // user part do ID serializado
      (senderIdObj?._serialized as string) ||             // ID serializado completo
      (body.from as string) ||                            // fallback: campo from (pode ser LID)
      (body.chatId as string) ||
      "";
  const phone = rawFrom.replace(/@.*/, "").replace(/\D/g, "");
  if (!phone) return NextResponse.json({ ok: true });

  console.log(`[WPPConnect Webhook] phone extraído: ${phone} (sender.number=${sender?.number} from=${body.from})`);

  // Extrai o texto da mensagem
  const text = (body.body as string) || (body.caption as string) || "";

  // Extrai o nome do contato
  const pushName = (sender?.pushname as string) || (body.notifyName as string) || phone;

  // ── CTWa: referral data (Click-to-WhatsApp) ──
  // WPPConnect expõe dados de anúncio no campo `referral`
  const referral = body.referral as Record<string, unknown> | undefined;
  const ctwaAdId      = referral?.source_id as string | undefined;
  const ctwaSourceUrl = referral?.source_url as string | undefined;
  const ctwaHeadline  = referral?.headline as string | undefined;

  // Encontra o funil vinculado
  const funnels = getFunnels();
  const funnel = funnels.find(f => f.id === wppSession.funnelId);
  const funnelId = funnel?.id ?? wppSession.funnelId!;
  const clientId = wppSession.clientId ?? funnel?.clientId ?? "sem-cliente";
  const entradaColumnId = funnel?.columns?.[0]?.id ?? "entrada";
  const connId = wppSession.id;

  const existingLead = getLeadByPhone(clientId, phone);
  const isNew = !existingLead;
  const shouldUpdateName = isNew || existingLead?.name === phone;

  // ── Lookup no Meta Ads API para enriquecer dados de campanha ──
  let adInfo: Awaited<ReturnType<typeof getAdInfoById>> = null;
  if (isNew && ctwaAdId) {
    try {
      const cfg = getConfig();
      if (cfg.metaToken) {
        adInfo = await getAdInfoById(ctwaAdId, cfg.metaToken);
      }
    } catch { /* best-effort */ }
  }

  const adFields = adInfo
    ? {
        adPlatform: "meta" as const,
        adId: adInfo.adId,
        adName: adInfo.adName,
        adSetId: adInfo.adSetId,
        adSetName: adInfo.adSetName,
        campaignId: adInfo.campaignId,
        campaignName: adInfo.campaignName,
        adSourceUrl: ctwaSourceUrl ?? null,
      }
    : ctwaAdId || ctwaHeadline
    ? {
        adPlatform: "meta" as const,
        adId: ctwaAdId ?? null,
        campaignName: ctwaHeadline ?? null,
        adSourceUrl: ctwaSourceUrl ?? null,
      }
    : {};

  // Detecta se o contato usa LID (novo sistema interno do WhatsApp)
  const isLidContact =
    String(body.chatId ?? "").endsWith("@lid") ||
    String(body.from ?? "").endsWith("@lid");

  // ── 1. Grava o lead IMEDIATAMENTE (sem esperar resolução do LID) ──
  const savedLead = upsertLeadByPhone(clientId, phone, {
    clientId,
    funnelId,
    source: "whatsapp",
    ...(shouldUpdateName ? { name: pushName } : {}),
    ...(isNew ? { status: entradaColumnId } : {}),
    ...(isLidContact ? { isLid: true } : {}),
    ...adFields,
  });

  // ── 2. Resolve o número real do LID em background (sem bloquear a resposta) ──
  const needsPhoneResolution = isLidContact && !savedLead.realPhone;
  if (needsPhoneResolution) {
    const lidJid = String(body.chatId ?? "").endsWith("@lid")
      ? String(body.chatId)
      : String(body.from ?? "").endsWith("@lid")
        ? String(body.from)
        : `${phone}@lid`;

    resolveContactPhone(wppSession.sessionName, wppSession.sessionToken, lidJid)
      .then((realPhone) => {
        if (realPhone && realPhone !== phone) {
          console.log(`[WPPConnect Webhook] LID ${phone} → número real: ${realPhone}`);
          updateLead(savedLead.id, { realPhone });

          // ── Remove duplicatas que possam ter sido criadas durante a resolução ──
          // Race condition: outro evento com o número real pode ter criado um lead
          // separado antes de realPhone ser gravado
          const allLeads = getLeads(clientId);
          for (const dup of allLeads) {
            if (dup.id !== savedLead.id && dup.phone.replace(/\D/g, "") === realPhone.replace(/\D/g, "")) {
              console.log(`[WPPConnect Webhook] Removendo duplicata com phone=${dup.phone} (LID já resolvido)`);
              deleteLead(dup.id);
            }
          }
        } else {
          console.log(`[WPPConnect Webhook] LID ${phone} pn-lid retornou: ${JSON.stringify(realPhone)}`);
        }
      })
      .catch((e) => {
        console.log(`[WPPConnect Webhook] LID ${phone} erro ao resolver: ${e}`);
      });
  }

  if (ctwaAdId) {
    console.log(`[WPPConnect Webhook] CTWa lead phone=${phone} adId=${ctwaAdId} adInfo=${JSON.stringify(adInfo)}`);
  }

  // ── Salva a mensagem na conversa (somente mensagens recebidas do lead) ──
  // Mensagens fromMe (IA ou plataforma) já são salvas por quem as envia.
  // Mensagens do celular do operador são salvas no bloco fromMe abaixo.
  if (text.trim() && !fromMe) {
    const ts = Date.now();
    addMessage(
      phone,
      { role: "user", content: text, ts },
      clientId,
      { connId, contactName: sanitizeContactName(pushName !== phone ? pushName : undefined, phone) },
    );
  }

  // Se foi enviado por nós (fromMe = IA, plataforma ou operador pelo celular)
  if (fromMe) {
    if (text.trim()) {
      // Se já foi salvo pela IA ou pela plataforma, apenas ignora
      if (consumeSent(phone, text.trim())) {
        return NextResponse.json({ ok: true });
      }
      // Operador enviou pelo celular → salva e pausa a IA
      addMessage(phone, { role: "assistant", content: text, ts: Date.now() }, clientId, { connId });
      const activeClientFM = clientId !== "sem-cliente" ? getClientById(clientId) : null;
      const agentCfgFM = activeClientFM ? getAgentConfigForConnection(activeClientFM, connId) : undefined;
      const resumeKeyword = agentCfgFM?.aiResumeKeyword?.trim();
      const isPausing = !(resumeKeyword && text.trim().toLowerCase() === resumeKeyword.toLowerCase());
      setAiPaused(phone, isPausing, clientId);
      const freshLead = getLeadByPhone(clientId, phone);
      if (freshLead) updateLead(freshLead.id, { aiPaused: isPausing });
    }
    return NextResponse.json({ ok: true });
  }
  if (!text.trim()) return NextResponse.json({ ok: true });

  // ── Agente Kanban — roda sempre, independente da IA de atendimento (fire-and-forget) ──
  // NOTA: getHistory já inclui a mensagem recém adicionada, então removemos o último
  // item para não duplicar (runKanbanAgent envia lastMessage separadamente)
  if (clientId !== "sem-cliente") {
    const _h = getHistory(phone, clientId);
    const historyForKanban = _h.length > 1 ? _h.slice(0, -1) : [];
    processKanbanActions(text, historyForKanban, clientId, phone).catch(() => {});
  }

  // ── Verifica IA ──
  const currentLead = getLeadByPhone(clientId, phone);
  if (currentLead?.aiPaused) return NextResponse.json({ ok: true });

  const activeClient = clientId !== "sem-cliente" ? getClientById(clientId) : null;
  const agentCfg = activeClient ? getAgentConfigForConnection(activeClient, connId) : undefined;
  const geminiEnabled = agentCfg?.enabled === true;

  if (!geminiEnabled || clientId === "sem-cliente") {
    return NextResponse.json({ ok: true });
  }

  // testPhone: quando configurado, IA responde APENAS este número
  if (agentCfg?.testPhone) {
    const testNorm = agentCfg.testPhone.replace(/\D/g, "");
    if (phone !== testNorm && !phone.endsWith(testNorm.slice(-9))) {
      return NextResponse.json({ ok: true });
    }
  }

  const waitSeconds = agentCfg?.messageWaitSeconds ?? 0;
  const history = getHistory(phone, clientId);

  // Helper: envia e registra a resposta da IA
  const isLidPhone =
    String(body.chatId ?? "").endsWith("@lid") ||
    String(body.from ?? "").endsWith("@lid");
  async function sendReply(reply: string) {
    const chunks = agentCfg?.splitMessages
      ? splitMessage(reply, agentCfg.maxMessageLength ?? 300)
      : [reply];
    // Marca cada chunk antes de enviar (evita pausar IA no onselfmessage de volta)
    for (const chunk of chunks) markSent(phone, chunk);
    // Salva a resposta completa no histórico (uma única vez)
    addMessage(phone, { role: "assistant", content: reply, ts: Date.now() }, clientId, { connId });
    // Envia cada chunk separadamente
    for (const chunk of chunks) {
      await wppSendText(wppSession!.sessionName, wppSession!.sessionToken, phone, chunk, isLidPhone);
    }
  }

  // ── Batching: acumula mensagens antes de responder ──
  if (waitSeconds > 0) {
    const pending = upsertPending(clientId, phone, text, waitSeconds);
    const _pendingId = pending.id;
    const _clientId = clientId;
    const _phone = phone;

    setTimeout(() => {
      const batch = getPendingForPhone(_clientId, _phone);
      if (!batch || batch.id !== _pendingId || batch.status !== "pending") return;
      markProcessing(batch.id);
      const combined = batch.messages.join("\n");
      const h = getHistory(_phone, _clientId);
      runGeminiAgent(combined, h, _clientId, _phone, connId)
        .then(async ({ text: geminiText }) => {
          markDone(batch.id);
          if (geminiText) await sendReply(geminiText);
        })
        .catch((e) => {
          console.error("[WPPConnect webhook] Erro no batch:", e);
          markDone(batch.id);
        });
    }, waitSeconds * 1000);

    return NextResponse.json({ ok: true });
  }

  // ── Resposta imediata (sem batching) ──
  cancelPendingForPhone(clientId, phone);
  try {
    const { text: geminiText } = await runGeminiAgent(text, history, clientId, phone, connId);
    if (geminiText) await sendReply(geminiText);
  } catch (e) {
    console.error("[WPPConnect webhook] Erro no Gemini:", e);
  }

  return NextResponse.json({ ok: true });
}
