import { NextRequest, NextResponse } from "next/server";
import { getWppSessionById } from "@/lib/wppconnect-sessions";
import { getFunnels } from "@/lib/funnels";
import { getLeads, getLeadByPhone, upsertLeadByPhone, updateLead, deleteLead } from "@/lib/leads";
import { getConfig, getClientById, getAgentConfigForConnection } from "@/lib/clients";
import { getAdInfoById } from "@/lib/meta-api";
import { getHistory, addMessage, setAiPaused, sanitizeContactName } from "@/lib/conversations";
import { markSent, consumeSent, isPhoneSending } from "@/lib/wppconnect-sent";
import { splitMessage } from "@/lib/uazapi";
import { runGeminiAgent } from "@/lib/gemini-agent";
import { processKanbanActions } from "@/lib/kanban-agent";
import { sendText as wppSendText, resolveContactPhone, getContactName } from "@/lib/wppconnect-api";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { getGeminiApiKey } from "@/lib/whatsapp-send";
import { transcribeMedia } from "@/lib/media-transcribe";
import type { AgentConfig } from "@/lib/clients";
import type { GeminiAction } from "@/lib/gemini-agent";
import { runAutomationsForMessage } from "@/lib/crm-automations";
import {
  upsertPending,
  getPendingForPhone,
  markProcessing,
  markDone,
  cancelPendingForPhone,
} from "@/lib/pending-responses";

export const dynamic = "force-dynamic";

// ── Resumo de conversa via WPPConnect ──

function buildBasicSummary(history: { role: string; content: string }[]): string {
  if (history.length === 0) return "Sem histórico de conversa.";
  const last8 = history.slice(-8);
  const lines = last8.map((m) => {
    const role = m.role === "user" ? "Lead" : "Agente";
    const content = m.content.length > 300 ? m.content.slice(0, 300) + "…" : m.content;
    return `*${role}:* ${content}`;
  });
  return `_Últimas mensagens da conversa:_\n\n${lines.join("\n\n")}`;
}

async function generateWppSummaryText(
  clientName: string,
  agCfg: AgentConfig,
  phone: string,
  motivo: string,
  clientId: string,
): Promise<string> {
  const history = getHistory(phone, clientId);
  if (history.length === 0) return "Sem histórico de conversa.";

  const recent = history.slice(-20);
  let transcript = recent
    .map((m) => `${m.role === "user" ? "Lead" : "Agente"}: ${m.content}`)
    .join("\n");
  if (transcript.length > 3000) transcript = transcript.slice(-3000);

  const apiKey = getGeminiApiKey(agCfg.geminiApiKey ?? undefined);
  if (apiKey) {
    const genAI = new GoogleGenerativeAI(apiKey);
    const prompt =
      `Você é um assistente que resume conversas de WhatsApp para o gestor.\n\n` +
      `Cliente/empresa: ${clientName}\n` +
      `Motivo do resumo: ${motivo}\n\n` +
      `Conversa:\n${transcript}\n\n` +
      `Faça um resumo objetivo em texto corrido (máximo 5 linhas) destacando: ` +
      `o que o lead quer, o estágio da conversa, dúvidas ou objeções levantadas, e próximo passo sugerido. ` +
      `Não use marcadores ou listas, escreva em parágrafos curtos.`;

    for (const modelId of ["gemini-2.5-flash", "gemini-2.5-pro", "gemini-1.5-pro"]) {
      try {
        const model = genAI.getGenerativeModel({ model: modelId });
        const result = await model.generateContent(prompt);
        const text = result.response.text().trim();
        if (text) return text;
      } catch (e) {
        console.error(`[wpp-summary] modelo ${modelId} falhou:`, e);
      }
    }
  }
  return buildBasicSummary(history);
}

async function processWppActions(
  actions: GeminiAction[],
  sessionName: string,
  sessionToken: string,
  clientName: string,
  agCfg: AgentConfig,
  leadPhone: string,
  isLid: boolean,
  clientId: string,
): Promise<void> {
  for (const action of actions) {
    if (action.type === "resumo_solicitado") {
      const summaryPhone = agCfg.summaryPhone;
      if (!summaryPhone) {
        console.log("[wpp-summary] summaryPhone não configurado — resumo ignorado");
        continue;
      }
      const resumo = await generateWppSummaryText(clientName, agCfg, leadPhone, action.motivo, clientId);
      const lead = getLeadByPhone(clientId, leadPhone);
      const displayPhone = (lead?.realPhone ?? leadPhone).replace(/\D/g, "");
      const waLink = `https://wa.me/${displayPhone}`;
      const msg =
        `📋 *Resumo de conversa — ${clientName}*\n\n` +
        `📞 *Lead:* ${waLink}\n` +
        `📝 *Motivo:* ${action.motivo}\n\n` +
        `${resumo}`;
      console.log(`[wpp-summary] Enviando resumo para ${summaryPhone}`);
      await wppSendText(sessionName, sessionToken, summaryPhone, msg, false);
    }
  }
}

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

  // ── Ignora mensagens históricas do sync de reconexão ──────────────────────
  // Quando o WPPConnect reconecta ele dispara eventos "onmessage" para mensagens
  // antigas (history sync). Filtramos mensagens com mais de 120s no passado.
  const msgTimestamp = (body.timestamp as number) || (body.t as number) || 0;
  if (msgTimestamp > 0) {
    const ageSec = Math.floor(Date.now() / 1000) - msgTimestamp;
    if (ageSec > 120) {
      console.log(`[WPPConnect Webhook] histórico ignorado: phone_raw=${body.from} age=${ageSec}s ts=${msgTimestamp}`);
      return NextResponse.json({ ok: true });
    }
  }

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

  // Detecta tipo de mensagem (chat, image, ptt, audio, video, document, sticker…)
  const msgType = ((body.type as string) ?? "").toLowerCase();
  const isMediaMsg = ["image", "video", "audio", "ptt", "document", "sticker"].includes(msgType);

  // ── Extrai texto e (para áudio/imagem) buffer para transcrição posterior ──
  let text = "";
  let contentForHistory = "";
  // Buffer de mídia para transcrição (preenchido se body.body contiver base64)
  let mediaBuffer: Buffer | undefined;
  let mediaMime = "";
  let mediaKind: "audio" | "image" | "video" | "document" | undefined;

  if (isMediaMsg) {
    const caption   = (body.caption as string)  || "";
    const filename  = (body.filename as string)  || "";
    const duration  = body.duration as number | undefined;
    const rawBody   = (body.body   as string)    || "";

    // Extrai mimeType e base64 puro do data-URI (formato "data:<mime>;base64,<data>")
    let mimeType = ((body.mimetype as string) || "").split(";")[0].trim();
    let base64Data = "";
    if (rawBody.startsWith("data:")) {
      const commaIdx = rawBody.indexOf(",");
      if (commaIdx > 0) {
        const header = rawBody.substring(5, commaIdx);
        const semiIdx = header.indexOf(";");
        if (!mimeType && semiIdx > 0) mimeType = header.substring(0, semiIdx);
        base64Data = rawBody.substring(commaIdx + 1);
      }
    } else if (rawBody.length > 200 && !rawBody.startsWith("http")) {
      base64Data = rawBody;
    }

    if (msgType === "ptt" || msgType === "audio") {
      const dur = duration ? ` de ${Math.round(duration)}s` : "";
      contentForHistory = `[Áudio${dur}]${caption ? ` ${caption}` : ""}`;
      if (base64Data) {
        mediaBuffer = Buffer.from(base64Data, "base64");
        mediaMime   = mimeType || "audio/ogg";
        mediaKind   = "audio";
        text = caption || contentForHistory; // placeholder substituído na transcrição
      } else {
        text = `[O usuário enviou um áudio${dur}. Não foi possível processar — peça para digitar.]`;
      }
    } else if (msgType === "image") {
      contentForHistory = `[Imagem]${caption ? `: ${caption}` : ""}`;
      if (base64Data) {
        mediaBuffer = Buffer.from(base64Data, "base64");
        mediaMime   = mimeType || "image/jpeg";
        mediaKind   = "image";
        text = caption || contentForHistory;
      } else {
        text = caption || "[O usuário enviou uma imagem]";
      }
    } else if (msgType === "video") {
      contentForHistory = `[Vídeo]${caption ? `: ${caption}` : ""}`;
      text = caption || "[O usuário enviou um vídeo]";
    } else if (msgType === "document") {
      const fname = filename || caption || "arquivo";
      contentForHistory = `[Documento: ${fname}]`;
      text = `[O usuário enviou um documento: ${fname}${caption && caption !== fname ? ` — ${caption}` : ""}]`;
    } else if (msgType === "sticker") {
      contentForHistory = "[Sticker]";
      text = "[O usuário enviou um sticker/figurinha]";
    } else {
      contentForHistory = `[Mídia: ${msgType}]${caption ? `: ${caption}` : ""}`;
      text = caption || `[O usuário enviou ${msgType}]`;
    }
  } else {
    // Mensagem de texto comum
    text = (body.body as string) || (body.caption as string) || "";
    contentForHistory = text;
  }

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
  // Só atualiza o nome a partir de mensagens RECEBIDAS do lead (fromMe=false).
  // Quando fromMe=true, o pushName é o do operador — não do lead.
  const shouldUpdateName = !fromMe && (isNew || existingLead?.name === phone);

  // Quando o operador manda primeiro (fromMe=true) e o lead é novo,
  // buscamos o nome do contato diretamente via API do WPPConnect.
  let contactNameFromApi: string | undefined;
  if (fromMe && isNew) {
    const fetched = await getContactName(wppSession.sessionName, wppSession.sessionToken, phone);
    if (fetched) contactNameFromApi = fetched;
  }
  // Nome final a salvar: API do contato (fromMe) > pushName (fromMe=false) > nada
  const nameToSave = contactNameFromApi ?? (shouldUpdateName ? pushName : undefined);

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
    ...(nameToSave ? { name: nameToSave } : {}),
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
  if (contentForHistory.trim() && !fromMe) {
    const ts = Date.now();
    addMessage(
      phone,
      { role: "user", content: contentForHistory, ts },
      clientId,
      { connId, contactName: sanitizeContactName(pushName !== phone ? pushName : undefined, phone) },
    );
  }

  // ── Automações por palavra-chave (message_received) ──
  if (!fromMe && text.trim() && clientId !== "sem-cliente") {
    runAutomationsForMessage(clientId, savedLead, text);
  }

  // Se foi enviado por nós (fromMe = IA, plataforma ou operador pelo celular)
  if (fromMe) {
    // Janela de envio ativa: qualquer eco (texto ou mídia, onanymessage ou onselfmessage)
    // não deve pausar a IA. O WPPConnect pode disparar 2 eventos para 1 mensagem enviada.
    if (isPhoneSending(phone)) {
      console.log(`[WPPConnect fromMe] phone=${phone} janela de envio ativa — não pausa IA`);
      return NextResponse.json({ ok: true });
    }
    if (text.trim()) {
      // Fora da janela: tenta match exato no registry (mensagens da IA/plataforma)
      const consumed = consumeSent(phone, text.trim());
      console.log(`[WPPConnect fromMe] phone=${phone} consumed=${consumed} text="${text.trim().slice(0, 80)}"`);
      if (consumed) {
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
  if (!text.trim() && !contentForHistory.trim()) return NextResponse.json({ ok: true });

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

  // ── Transcreve áudio/imagem ANTES do agente (evita conflito com function calling) ──
  if (mediaBuffer && mediaMime && mediaKind) {
    const apiKey = getGeminiApiKey(agentCfg?.geminiApiKey ?? undefined);
    if (apiKey) {
      console.log(`[WPPConnect Webhook] Transcrevendo ${mediaKind} (${mediaBuffer.length} bytes, mime=${mediaMime})`);
      try {
        const transcription = await transcribeMedia(mediaBuffer, mediaMime, apiKey, mediaKind);
        if (transcription) {
          text = transcription;
          console.log(`[WPPConnect Webhook] Transcrição OK: "${transcription.slice(0, 120)}"`);
        } else {
          console.warn(`[WPPConnect Webhook] Transcrição retornou vazio — usando placeholder`);
        }
      } catch (e) {
        console.error("[WPPConnect Webhook] Erro na transcrição de mídia:", e);
      }
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
        .then(async ({ text: geminiText, actions }) => {
          markDone(batch.id);
          if (geminiText) await sendReply(geminiText);
          if (actions.length && activeClient && agentCfg) {
            await processWppActions(actions, wppSession!.sessionName, wppSession!.sessionToken, activeClient.name, agentCfg, _phone, isLidPhone, _clientId).catch(() => {});
          }
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
    const { text: geminiText, actions } = await runGeminiAgent(text, history, clientId, phone, connId);
    if (geminiText) await sendReply(geminiText);
    if (actions.length && activeClient && agentCfg) {
      await processWppActions(actions, wppSession!.sessionName, wppSession!.sessionToken, activeClient.name, agentCfg, phone, isLidPhone, clientId).catch(() => {});
    }
  } catch (e) {
    console.error("[WPPConnect webhook] Erro no Gemini:", e);
  }

  return NextResponse.json({ ok: true });
}
