/**
 * Webhook por instância: /api/whatsapp/webhook/{instanceId}
 *
 * Cada instância UazapiGO tem sua própria URL de webhook.
 * Ao receber uma mensagem aqui, já sabemos exatamente qual instância/cliente/funil
 * está sendo usado — sem tentativa de adivinhação.
 *
 * Fluxo:
 *  1. UazapiGO envia POST para /api/whatsapp/webhook/{instanceName}
 *  2. Buscamos o funil vinculado a esta instância (connection.id === instanceId)
 *  3. Criamos/atualizamos lead no CRM (coluna "entrada")
 *  4. Se agente IA ativo → Gemini responde e envia via UazapiGO
 */
import { NextRequest, NextResponse } from "next/server";
import { readFileSync, writeFileSync, existsSync } from "fs";
import path from "path";
import { getFunnels } from "@/lib/funnels";
import { getClientById, getConfig, getAgentConfigForConnection } from "@/lib/clients";
import { getHistory, addMessage, getAiPaused, setAiPaused, sanitizeContactName } from "@/lib/conversations";
import { upsertLeadByPhone, getLeadByPhone, updateLead } from "@/lib/leads";
import { runGeminiAgent } from "@/lib/gemini-agent";
import { sendText, sendMedia, splitMessage } from "@/lib/uazapi";
import { consumeSent, isPhoneSending } from "@/lib/wppconnect-sent";
import { downloadAndDecryptMedia, transcribeMedia, saveDecryptedMedia } from "@/lib/media-transcribe";
import type { AgentMedia, AgentConfig } from "@/lib/clients";
import type { GeminiAction } from "@/lib/gemini-agent";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { getGeminiApiKey } from "@/lib/whatsapp-send";
import { getAdInfoById } from "@/lib/meta-api";

/**
 * Usa o Gemini para gerar um resumo em texto corrido da conversa.
 */
/**
 * Gera um resumo simples da conversa baseado nas últimas mensagens (sem IA).
 * Usado como fallback quando o Gemini não está disponível.
 */
function buildBasicSummary(history: import("@/lib/conversations").ChatMessage[]): string {
  if (history.length === 0) return "Sem histórico de conversa.";
  const last8 = history.slice(-8);
  const lines = last8.map((m) => {
    const role = m.role === "user" ? "Lead" : "Agente";
    const content = m.content.length > 300 ? m.content.slice(0, 300) + "…" : m.content;
    return `*${role}:* ${content}`;
  });
  return `_Últimas mensagens da conversa:_\n\n${lines.join("\n\n")}`;
}

async function generateSummaryText(
  clientName: string,
  agCfg: AgentConfig,
  phone: string,
  motivo: string,
): Promise<string> {
  const history = getHistory(phone);
  if (history.length === 0) return "Sem histórico de conversa.";

  // Limita às últimas 20 mensagens e 3000 chars para evitar token limit
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

    const modelsToTry = [
      "gemini-2.5-flash-preview-05-20",
      "gemini-2.5-flash",
      "gemini-2.5-flash-preview-04-17",
      "gemini-2.5-pro-preview-05-06",
      "gemini-2.5-pro",
    ];
    for (const modelId of modelsToTry) {
      try {
        const model = genAI.getGenerativeModel({ model: modelId });
        const result = await model.generateContent(prompt);
        const text = result.response.text().trim();
        if (text) {
          console.log(`[generateSummaryText] Sucesso com modelo ${modelId}`);
          return text;
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        console.error(`[generateSummaryText] Falha com modelo ${modelId}: ${errMsg}`);
      }
    }
    console.error("[generateSummaryText] Todos os modelos Gemini falharam — usando resumo básico");
  } else {
    console.error("[generateSummaryText] Chave Gemini não encontrada — usando resumo básico");
  }

  // Fallback: resumo básico das últimas mensagens (sem IA)
  return buildBasicSummary(history);
}

/**
 * Envia resumo de conversa para o summaryPhone do cliente, com link wa.me para o lead.
 */
async function sendConversationSummary(
  token: string,
  clientName: string,
  agCfg: AgentConfig,
  phone: string,
  motivo: string,
): Promise<void> {
  const summaryPhone = agCfg.summaryPhone;
  if (!summaryPhone) return;

  const resumo = await generateSummaryText(clientName, agCfg, phone, motivo);
  const waLink = `https://wa.me/${phone.replace(/\D/g, "")}`;

  const msg =
    `📋 *Resumo de conversa — ${clientName}*\n\n` +
    `📞 *Lead:* ${waLink}\n` +
    `📝 *Motivo:* ${motivo}\n\n` +
    `${resumo}`;

  await sendText(token, summaryPhone, msg);
}

/**
 * Processa as actions retornadas pelo Gemini (exceto follow-ups, já tratados no agente).
 */
async function processGeminiActions(
  actions: GeminiAction[],
  token: string,
  clientName: string,
  agCfg: AgentConfig,
  phone: string,
): Promise<void> {
  for (const action of actions) {
    if (action.type === "resumo_solicitado") {
      await sendConversationSummary(token, clientName, agCfg, phone, action.motivo);
    }
  }
}

/**
 * Remove marcadores [MIDIA:nome] e [APOS_MIDIA:texto] do texto e retorna os nomes encontrados + texto limpo + followup.
 */
function extractMediaMarkers(text: string): { clean: string; names: string[]; followup?: string } {
  // Extrai [APOS_MIDIA:texto] para enviar após as mídias
  const followupPattern = /\[APOS_MIDIA:([\s\S]*?)\]/i;
  const followupMatch = text.match(followupPattern);
  const followup = followupMatch ? followupMatch[1].trim() : undefined;
  const textWithoutFollowup = text.replace(followupPattern, "").trim();

  const pattern = /\[MIDIA:([^\]]+)\]/gi;
  const names: string[] = [];
  const clean = textWithoutFollowup.replace(pattern, (_, name: string) => {
    names.push(name.trim().toLowerCase());
    return "";
  }).replace(/\s{2,}/g, " ").trim();
  return { clean, names, followup };
}

/**
 * Envia mídias referenciadas pelo agente após enviar o texto principal.
 */
/** Converte URL local /api/uploads/... em base64 lendo direto do disco */
function resolveMediaPayload(url: string): string {
  const localMatch = url.match(/\/api\/uploads\/([^/?#]+)$/);
  if (!localMatch) return url;
  try {
    const filePath = path.join(process.cwd(), "data", "uploads", localMatch[1]);
    if (!existsSync(filePath)) return url;
    const buffer = readFileSync(filePath);
    const ext = localMatch[1].split(".").pop()?.toLowerCase() ?? "";
    const mimeMap: Record<string, string> = {
      jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png",
      gif: "image/gif", webp: "image/webp", mp4: "video/mp4",
      pdf: "application/pdf",
      doc: "application/msword",
      docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    };
    const mime = mimeMap[ext] ?? "application/octet-stream";
    return `data:${mime};base64,${buffer.toString("base64")}`;
  } catch (e) {
    console.error("[resolveMediaPayload] Erro ao ler arquivo local:", e);
    return url;
  }
}

async function sendMarkedMedia(
  token: string,
  phone: string,
  names: string[],
  library: AgentMedia[],
): Promise<void> {
  const libraryNames = library.map((m) => m.name?.toLowerCase());
  for (const name of names) {
    const media = library.find((m) => m.name?.toLowerCase() === name);
    if (!media) {
      console.warn(`[sendMarkedMedia] Mídia "${name}" não encontrada. Library: ${JSON.stringify(libraryNames)}`);
      continue;
    }
    const payload = resolveMediaPayload(media.url);
    const isBase64 = payload.startsWith("data:");
    console.log(`[sendMarkedMedia] Enviando "${name}" (${media.type}) isBase64=${isBase64} url=${isBase64 ? "[base64]" : media.url}`);
    const result = await sendMedia(token, phone, media.type, payload, media.caption, media.filename);
    console.log(`[sendMarkedMedia] Resultado "${name}": ${result}`);
    await new Promise<void>((r) => setTimeout(r, 700));
  }
}
import {
  startFollowUpSequence,
  cancelFollowUpsForPhone,
} from "@/lib/followups";
import {
  upsertPending,
  getPendingForPhone,
  markDone,
  markProcessing,
} from "@/lib/pending-responses";
import { processKanbanActions } from "@/lib/kanban-agent";

type Body = Record<string, unknown>;

// ── Extrai mensagem em diferentes formatos ──────────────────────────────────
function extractMessage(body: Body): { phone: string; text: string; fromMe: boolean; msgType?: string; mediaUrl?: string } | null {
  // ── Formato UazapiGO: { EventType:"messages", chat:{phone}, messages:[{body,fromMe}] } ──
  const eventType = (body.EventType ?? body.eventType) as string | undefined;
  const chat = body.chat as Record<string, unknown> | undefined;
  const msgObj = body.message as Record<string, unknown> | undefined;

  if (eventType === "messages" || eventType === "message" || chat?.phone) {
    // Tenta extrair do array messages[]
    const msgs = body.messages as Record<string, unknown>[] | undefined;
    if (Array.isArray(msgs) && msgs.length > 0) {
      const msg = msgs[0];
      const fromMe = msg.fromMe === true || msg.from_me === true;
      // Para mensagens fromMe, msg.phone é o remetente (número da empresa).
      // O número do CONTATO está em chat.phone — priorizamos ele quando fromMe=true.
      const rawPhone = fromMe
        ? String(chat?.phone ?? msg.phone ?? msg.sender ?? msg.from ?? "")
        : String(msg.phone ?? msg.sender ?? msg.from ?? chat?.phone ?? "");
      const phone = rawPhone.replace("@s.whatsapp.net", "").replace(/\D/g, "");

      const rawBody = msg.body ?? msg.message ?? msg.text ?? msg.content ?? msg.conversation ?? "";
      let text: string;
      if (typeof rawBody === "string") {
        text = rawBody;
      } else if (rawBody && typeof rawBody === "object") {
        const obj = rawBody as Record<string, unknown>;
        text = String(obj.text ?? obj.caption ?? obj.body ?? obj.conversation ?? "");
      } else {
        text = "";
      }
      if (!text && msg.caption) text = String(msg.caption);

      // Detecta tipo de mídia (audio, image, video, ptt)
      const rawType = String(msg.type ?? msg.messageType ?? "").toLowerCase();
      const mimetype = String(msg.mimetype ?? msg.mimeType ?? "").toLowerCase();
      let msgType: string | undefined;
      let mediaUrl: string | undefined;
      const possibleMediaUrl = String(msg.media ?? msg.mediaUrl ?? msg.url ?? msg.link ?? "") || undefined;

      if (rawType === "audio" || rawType === "ptt" || rawType === "voice" ||
          msg.ptt === true || mimetype.startsWith("audio/")) {
        msgType = "audio";
        mediaUrl = possibleMediaUrl;
      } else if (rawType === "image" || mimetype.startsWith("image/")) {
        msgType = "image";
        mediaUrl = possibleMediaUrl;
      } else if (rawType === "video" || mimetype.startsWith("video/")) {
        msgType = "video";
        mediaUrl = possibleMediaUrl;
      } else if (rawType === "document" || rawType === "file") {
        msgType = "document";
      }

      // Fallback: texto vazio mas tem URL de mídia → trata como áudio
      if (!text && !msgType && possibleMediaUrl) {
        msgType = "audio";
        mediaUrl = possibleMediaUrl;
      }

      console.log(`[webhook/extractMessage] rawType=${rawType} mimetype=${mimetype} msgType=${msgType} ptt=${msg.ptt} mediaUrl=${mediaUrl?.slice(0, 60) ?? "none"}`);

      if (phone) return { phone, text, fromMe, msgType, mediaUrl };
    }

    // Tenta extrair de body.message (objeto singular com o texto)
    // Tenta extrair phone do chat ou do próprio objeto de mensagem
    const rawChatPhone =
      String(chat?.phone ?? "").replace(/\D/g, "") ||
      (msgObj ? String(msgObj.phone ?? msgObj.chatId ?? msgObj.chatid ?? "").replace("@s.whatsapp.net", "").replace("@lid", "").replace(/\D/g, "") : "");
    const chatPhone = rawChatPhone;
    if (chatPhone) {
      let text = "";
      let fromMe = false;

      if (msgObj) {
        // message é objeto: { body, text, conversation, fromMe, ... }
        text =
          (typeof msgObj.body === "string" ? msgObj.body : "") ||
          (typeof msgObj.text === "string" ? msgObj.text : "") ||
          (typeof msgObj.conversation === "string" ? msgObj.conversation : "") ||
          (typeof msgObj.caption === "string" ? msgObj.caption : "") ||
          ((msgObj.extendedTextMessage as Record<string, string> | undefined)?.text ?? "") ||
          "";
        fromMe = msgObj.fromMe === true || msgObj.fromMe === "true";
      } else if (typeof body.message === "string") {
        text = body.message;
        fromMe = body.fromMe === true;
      }

      // Fallback: body na raiz
      if (!text) {
        text =
          (typeof body.body === "string" ? body.body : "") ||
          (typeof body.text === "string" ? body.text : "") ||
          "";
      }

      // Detecta tipo de mídia no caminho singular (body.message)
      // UazapiGO envia: { type:"media", messageType:"AudioMessage", mediaType:"ptt",
      //   message: { mimetype:"audio/ogg...", PTT:true, content:{URL:"..."} } }
      const singularSrc = msgObj ?? body;
      // UazapiGO nexopro: body.message.content contém URL, mimetype, mediaKey, PTT
      const singularContent = (singularSrc.content as Record<string, unknown> | undefined) ?? {};

      const singularType      = String(singularSrc.type ?? "").toLowerCase();       // "media"
      const singularMsgType2  = String(singularSrc.messageType ?? "").toLowerCase(); // "audiomessage"
      const singularMediaType = String(singularSrc.mediaType ?? "").toLowerCase();   // "ptt"
      const singularMime = String(
        singularSrc.mimetype ?? singularSrc.mimeType ??
        singularContent.mimetype ?? singularContent.mimeType ?? ""
      ).toLowerCase(); // "audio/ogg; codecs=opus"
      const singularMediaUrl =
        String(singularSrc.media ?? singularSrc.mediaUrl ?? singularSrc.url ?? singularSrc.link ??
          singularContent.URL ?? singularContent.url ?? singularContent.directPath ?? "") || undefined;
      const isPtt = singularSrc.ptt === true || singularContent.PTT === true || singularContent.ptt === true;

      let singularMsgTypeFinal: string | undefined;
      let singularMedia: string | undefined;

      const isAudio =
        singularType === "audio" || singularType === "ptt" || singularType === "voice" ||
        singularMsgType2 === "audiomessage" || singularMsgType2.includes("audio") ||
        singularMediaType === "ptt" || singularMediaType === "audio" ||
        isPtt || singularMime.startsWith("audio/");

      const isImage =
        !isAudio && (
          singularType === "image" || singularMsgType2 === "imagemessage" ||
          singularMediaType === "image" || singularMime.startsWith("image/")
        );

      const isVideo =
        !isAudio && !isImage && (
          singularType === "video" || singularMsgType2 === "videomessage" ||
          singularMediaType === "video" || singularMime.startsWith("video/")
        );

      const isDocument =
        !isAudio && !isImage && !isVideo && (
          singularType === "document" || singularType === "file" ||
          singularMsgType2 === "documentmessage" || singularMediaType === "document"
        );

      if (isAudio) {
        singularMsgTypeFinal = "audio";
        singularMedia = singularMediaUrl;
      } else if (isImage) {
        singularMsgTypeFinal = "image";
        singularMedia = singularMediaUrl;
      } else if (isVideo) {
        singularMsgTypeFinal = "video";
        singularMedia = singularMediaUrl;
      } else if (isDocument) {
        singularMsgTypeFinal = "document";
        singularMedia = singularMediaUrl;
      } else if (!text && singularMediaUrl) {
        // Fallback genérico: sem texto mas tem URL de mídia → assume áudio
        singularMsgTypeFinal = "audio";
        singularMedia = singularMediaUrl;
      }

      console.log(`[webhook/extractMessage/singular] type=${singularType} messageType=${singularMsgType2} mediaType=${singularMediaType} mime=${singularMime} ptt=${isPtt} detected=${singularMsgTypeFinal} mediaUrl=${singularMedia?.slice(0, 60) ?? "none"}`);

      return { phone: chatPhone, text, fromMe, msgType: singularMsgTypeFinal, mediaUrl: singularMedia };
    }
  }

  // ── Formato UazAPI legado: { phone, message } ──
  if (typeof body.phone === "string" && typeof body.message === "string") {
    return {
      phone: body.phone.replace(/\D/g, ""),
      text: body.message,
      fromMe: body.fromMe === true,
    };
  }

  // ── Formato Evolution API / alternativo: { data: { key, message } } ──
  const data = body.data as Body | undefined;
  if (data) {
    const key = data.key as Record<string, unknown> | undefined;
    if (key?.remoteJid) {
      const phone = String(key.remoteJid).replace("@s.whatsapp.net", "").replace(/\D/g, "");
      const msg = data.message as Record<string, unknown> | undefined;
      const text =
        (msg?.conversation as string) ||
        ((msg?.extendedTextMessage as Record<string, string> | undefined)?.text ?? "");
      const fromMe = key.fromMe === true || key.fromMe === "true";
      return { phone, text, fromMe };
    }
  }

  return null;
}

function isGroup(phone: string): boolean {
  return phone.includes("@g.us") || phone.endsWith("@broadcast");
}

/** Salva os últimos 20 payloads recebidos para diagnóstico. */
function saveWebhookDebug(entry: Record<string, unknown>) {
  try {
    const file = path.join(process.cwd(), "data", "webhook-debug.json");
    const existing = existsSync(file)
      ? JSON.parse(readFileSync(file, "utf-8")) as { entries: unknown[] }
      : { entries: [] };
    existing.entries = [entry, ...existing.entries].slice(0, 20);
    writeFileSync(file, JSON.stringify(existing, null, 2));
  } catch { /* silently ignore */ }
}

function isValidPhone(phone: string): boolean {
  return phone.length >= 7 && phone.length <= 20;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ instanceId: string }> },
) {
  const { instanceId } = await params;

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 });
  }

  // Salva debug: guarda os últimos payloads para diagnóstico via /api/debug/webhooks
  saveWebhookDebug({ ts: Date.now(), instanceId, body });

  console.log(`[webhook/${instanceId}] body=`, JSON.stringify(body).slice(0, 4000));

  // Forward para URL configurada (fire-and-forget)
  const config = getConfig();
  if (config.uazapiWebhookForward) {
    fetch(config.uazapiWebhookForward, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, _instanceId: instanceId }),
    }).catch(() => {});
  }

  try {
    const extracted = extractMessage(body);
    console.log(`[webhook/${instanceId}] extracted=`, JSON.stringify(extracted));
    if (!extracted) {
      console.log(`[webhook/${instanceId}] IGNORADO — não foi possível extrair mensagem do payload`);
      return NextResponse.json({ ok: true });
    }
    if (isGroup(extracted.phone)) {
      console.log(`[webhook/${instanceId}] IGNORADO — mensagem de grupo phone=${extracted.phone}`);
      return NextResponse.json({ ok: true });
    }
    if (!isValidPhone(extracted.phone)) {
      console.log(`[webhook/${instanceId}] IGNORADO — telefone inválido phone=${extracted.phone}`);
      return NextResponse.json({ ok: true });
    }

    const { phone, text, fromMe, msgType, mediaUrl } = extracted;

    // ── Encontra funil + cliente pelo instanceId (token UUID na URL) ──────────
    // O instanceId na URL É o token UazapiGO da instância (UUID opaco)
    // Isso serve como autenticação: impossível de adivinhar
    const funnels = getFunnels();

    // Busca primária: connection.uazapiToken === instanceId (token UUID na URL)
    const matchedFunnel = funnels.find((f) =>
      f.connections?.some((c) => c.type === "uazapi" && c.uazapiToken === instanceId)
    );

    // Fallback 1: token enviado no body pelo UazapiGO (instanceToken ou token)
    const bodyToken = (body.instanceToken ?? body.token) as string | undefined;
    const fallbackByBodyToken = !matchedFunnel && bodyToken
      ? funnels.find((f) =>
          f.connections?.some((c) => c.uazapiToken === bodyToken)
        )
      : undefined;

    // Fallback 2: body.instanceId ou body.instance = nome da instância enviado pelo UazapiGO
    // (UazapiGO envia o nome da instância no body, ex: "nexo")
    const bodyInstanceName = (body.instanceId ?? body.instance) as string | undefined;
    const fallbackByBodyName = !matchedFunnel && !fallbackByBodyToken && bodyInstanceName
      ? funnels.find((f) =>
          f.connections?.some((c) => c.type === "uazapi" && c.id === bodyInstanceName)
        )
      : undefined;

    // Fallback 3: connection.id === instanceId (caso raro onde URL contém o nome)
    const fallbackByUrlName = !matchedFunnel && !fallbackByBodyToken && !fallbackByBodyName
      ? funnels.find((f) =>
          f.connections?.some((c) => c.type === "uazapi" && c.id === instanceId)
        )
      : undefined;

    const funnel = matchedFunnel ?? fallbackByBodyToken ?? fallbackByBodyName ?? fallbackByUrlName ?? null;
    const clientId = funnel?.clientId ?? null;

    // Token para enviar a resposta:
    // 1. instanceId na URL se for UUID (contém "-") → é o próprio token UazapiGO
    // 2. token da conexão do funil encontrada
    // 3. bodyToken enviado pelo UazapiGO
    // 4. token global como último recurso
    const uazConn = funnel?.connections?.find((c) => c.type === "uazapi");
    const instanceUazToken = instanceId.includes("-")
      ? instanceId  // UUID → é o próprio token UazapiGO
      : (uazConn?.uazapiToken ?? bodyToken ?? config.uazapiToken ?? "");

    // ── Upsert lead no CRM ────────────────────────────────────────────────
    // Nome do contato: UazapiGO envia em messages[0].pushName ou chat.name
    const firstMsg = (Array.isArray(body.messages) ? (body.messages as Record<string, unknown>[])[0] : null);
    const chatObj  = body.chat as Record<string, unknown> | undefined;
    const rawContactName =
      (firstMsg?.pushName as string) ||
      (chatObj?.name as string) ||
      (body.chatName as string) ||
      (body.senderName as string) ||
      (body.pushName as string) ||
      phone;
    const contactName = sanitizeContactName(rawContactName, phone) ?? phone;

    const cid = clientId ?? "sem-cliente";
    const funnelId = funnel?.id ?? "default";
    const existingLead = getLeadByPhone(cid, phone);
    const isNew = !existingLead;
    const shouldUpdateName = isNew || existingLead?.name === phone;

    // Coluna de entrada: primeira coluna do funil (normalmente "entrada" / "novo")
    const entradaColumn = funnel?.columns?.[0]?.id ?? "entrada";

    // ── Rastreio CTWa via referral do UazapiGO ───────────────────────────
    // UazapiGO repassa o referral de mensagens Click-to-WhatsApp.
    // Campos: source_id (ad_id), source_url, headline, ctwa_clid, body
    const ctwaReferral = (
      firstMsg?.referral ??
      (body.message as Record<string, unknown> | undefined)?.referral ??
      body.referral
    ) as Record<string, unknown> | undefined;

    const ctwaAdId = ctwaReferral?.source_id as string | undefined;

    // Busca info completa do anúncio via Meta Ads API (assíncrono, apenas lead novo)
    let adInfo: Awaited<ReturnType<typeof getAdInfoById>> = null;
    if (isNew && ctwaAdId) {
      const cfg = getConfig();
      const token = cfg.metaToken;
      if (token) {
        adInfo = await getAdInfoById(ctwaAdId, token).catch(() => null);
        console.log(`[webhook/${instanceId}] CTWa ad lookup adId=${ctwaAdId}`, adInfo);
      }
    }

    upsertLeadByPhone(cid, phone, {
      clientId: cid,
      funnelId,
      source: "whatsapp",
      ...(shouldUpdateName ? { name: contactName } : {}),
      ...(isNew ? { status: entradaColumn } : {}),
      ...(adInfo ? {
        adPlatform: "meta",
        adId: adInfo.adId,
        adName: adInfo.adName,
        adSetId: adInfo.adSetId,
        adSetName: adInfo.adSetName,
        campaignId: adInfo.campaignId,
        campaignName: adInfo.campaignName,
        adSourceUrl: (ctwaReferral?.source_url as string) ?? null,
      } : ctwaReferral ? {
        // Fallback: sem token Meta mas tem referral — salva o que veio no payload
        adPlatform: "meta",
        adId: ctwaAdId ?? null,
        campaignName: (ctwaReferral.headline as string) ?? null,
        adSourceUrl: (ctwaReferral.source_url as string) ?? null,
      } : {}),
    });

    // Guarda: pula apenas se não há texto, não há tipo e não há URL de mídia
    if (!text.trim() && !msgType && !mediaUrl) {
      console.log(`[webhook/${instanceId}] IGNORADO — mensagem vazia (sem texto, tipo ou mídia) phone=${phone}`);
      return NextResponse.json({ ok: true });
    }

    // ── Transcrição síncrona de mídia ─────────────────────────────────────
    // Feita ANTES de salvar no histórico e chamar o Gemini, para a IA ver o conteúdo real.
    const ts = Date.now();
    let transcribedContent: string | null = null;
    let localMediaUrl: string | undefined;

    if (!fromMe && msgType && msgType !== "text" && cid !== "sem-cliente") {
      const agCfgForMedia = getAgentConfigForConnection(getClientById(cid)!, uazConn?.id);
      const gemKey = getGeminiApiKey(agCfgForMedia?.geminiApiKey ?? undefined);

      if (gemKey) {
        // ── Extração de URL/chave: cobre TODOS os formatos UazapiGO conhecidos ─
        // Formato 1 (singular): body.message.content.URL + mediaKey (UazapiGO nexopro)
        const msgBodyObj = (body.message as Record<string, unknown> | undefined) ?? {};
        const msgBodyContent = (msgBodyObj.content as Record<string, unknown> | undefined) ?? {};

        // Formato 2 (array): body.messages[0].* com subníveis
        const msgArr = body.messages as Record<string, unknown>[] | undefined;
        const msg0 = (Array.isArray(msgArr) && msgArr.length > 0 ? msgArr[0] : {}) as Record<string, unknown>;
        const msg0Nested = (msg0.message as Record<string, unknown> | undefined) ?? {};
        const msg0Content = (msg0Nested.content as Record<string, unknown> | undefined) ?? {};

        // Log diagnóstico: mostra os campos brutos que temos
        console.log(`[webhook/${instanceId}] [media-diag] msg0 keys=${JSON.stringify(Object.keys(msg0))} body=${String(msg0.body ?? "").slice(0, 80)} media=${String(msg0.media ?? "")} mediaKey=${String(msg0.mediaKey ?? "").slice(0, 20)}`);
        console.log(`[webhook/${instanceId}] [media-diag] msgBodyContent keys=${JSON.stringify(Object.keys(msgBodyContent))} msgBodyObj keys=${JSON.stringify(Object.keys(msgBodyObj))}`);

        // mediaKey: body.message.content.mediaKey (UazapiGO nexopro) + fallbacks
        const mediaKeyB64 = String(
          msgBodyContent.mediaKey ?? msg0.mediaKey ?? msg0Nested.mediaKey ??
          msgBodyObj.mediaKey ?? body.mediaKey ?? ""
        );

        // CDN URL: criptografada, precisa HKDF. Pode estar em vários campos.
        const bodyAsUrl = typeof body.body === "string" && (body.body.startsWith("https://") || body.body.startsWith("http://")) ? body.body : "";
        const msg0BodyAsUrl = typeof msg0.body === "string" && (msg0.body.startsWith("https://") || msg0.body.startsWith("http://")) ? msg0.body : "";
        const textIsUrl = !!text && !!msgType && (text.startsWith("https://") || text.startsWith("http://"));
        const cdnUrl = (
          String(msgBodyContent.URL ?? msgBodyContent.url ?? msgBodyContent.directPath ?? "") ||
          String(msg0Content.URL ?? msg0Nested.url ?? msg0Nested.directPath ?? "") ||
          msg0BodyAsUrl || bodyAsUrl || (textIsUrl ? text : "")
        );

        // URL direta (já descriptografada pelo UazapiGO ou pré-assinada)
        const directUrl = String(
          mediaUrl ??
          msg0.media ?? msg0.mediaUrl ?? msg0.url ?? msg0.link ??
          msgBodyObj.media ?? msgBodyObj.url ?? ""
        );

        // Mimetype: body.message.content.mimetype (UazapiGO nexopro) + fallbacks
        const mediaMimetype = String(
          msgBodyContent.mimetype ?? msgBodyContent.mimeType ??
          msg0.mimetype ?? msg0.mimeType ?? msg0Nested.mimetype ??
          msgBodyObj.mimetype ?? msgBodyObj.mimeType ??
          (msgType === "audio" ? "audio/ogg" :
           msgType === "image" ? "image/jpeg" :
           msgType === "video" ? "video/mp4" : "application/octet-stream")
        );
        const mediaTypeStr = String(
          msgBodyObj.mediaType ?? msgBodyObj.messageType ??
          msg0.mediaType ?? msg0.messageType ?? msgType ?? "audio"
        );
        const kind = (
          msgType === "image" ? "image" :
          msgType === "video" ? "video" :
          msgType === "document" ? "document" : "audio"
        ) as import("@/lib/media-transcribe").MediaKind;

        console.log(`[webhook/${instanceId}] Transcrição síncrona kind=${kind} cdnUrl=${cdnUrl.slice(0, 100)} directUrl=${directUrl.slice(0, 100)} hasKey=${!!mediaKeyB64} mime=${mediaMimetype}`);

        if (cdnUrl || directUrl) {
          try {
            const transcribeResult = await Promise.race([
              (async (): Promise<string | null> => {
                let buffer: Buffer | null = null;

                // 1. CDN criptografado (HKDF + AES-256-CBC)
                if (cdnUrl && mediaKeyB64) {
                  buffer = await downloadAndDecryptMedia(cdnUrl, mediaKeyB64, mediaTypeStr);
                  if (buffer) console.log(`[webhook/${instanceId}] CDN decrypt OK: ${buffer.length} bytes`);
                }

                // 2. URL direta (já descriptografada pelo UazapiGO)
                const dlTimeout = kind === "video" ? 30_000 : 15_000;
                if (!buffer && directUrl) {
                  try {
                    const res = await fetch(directUrl, { signal: AbortSignal.timeout(dlTimeout) });
                    if (res.ok) {
                      buffer = Buffer.from(await res.arrayBuffer());
                      console.log(`[webhook/${instanceId}] Download direto OK: ${buffer.length} bytes`);
                    } else {
                      console.warn(`[webhook/${instanceId}] Download direto HTTP ${res.status}`);
                    }
                  } catch (fe) {
                    console.error(`[webhook/${instanceId}] Erro download direto:`, fe instanceof Error ? fe.message : fe);
                  }
                }

                // 3. Fallback: tenta CDN sem mediaKey (UazapiGO pode servir URL pré-autenticada)
                if (!buffer && cdnUrl) {
                  try {
                    const res = await fetch(cdnUrl, {
                      headers: { "User-Agent": "WhatsApp/2.24.10.0" },
                      signal: AbortSignal.timeout(dlTimeout),
                    });
                    if (res.ok) {
                      buffer = Buffer.from(await res.arrayBuffer());
                      console.log(`[webhook/${instanceId}] CDN direto OK: ${buffer.length} bytes`);
                    } else {
                      console.warn(`[webhook/${instanceId}] CDN direto HTTP ${res.status}`);
                    }
                  } catch { /* silently ignore */ }
                }

                // 4. Fallback: base64 embutido no campo body/text da mensagem
                if (!buffer) {
                  const rawBase64Candidate = typeof msg0.body === "string" ? msg0.body : (typeof body.body === "string" ? body.body : "");
                  const isBase64 = rawBase64Candidate.length > 100 && !rawBase64Candidate.includes(" ") && /^[A-Za-z0-9+/=]+$/.test(rawBase64Candidate.slice(0, 100));
                  if (isBase64) {
                    try {
                      buffer = Buffer.from(rawBase64Candidate, "base64");
                      console.log(`[webhook/${instanceId}] Base64 inline OK: ${buffer.length} bytes`);
                    } catch { /* silently ignore */ }
                  }
                }

                if (!buffer) {
                  console.warn(`[webhook/${instanceId}] Nenhum buffer obtido para kind=${kind} — verifique /api/debug/webhooks para ver o payload`);
                  return null;
                }

                // Salva cópia local
                localMediaUrl = saveDecryptedMedia(buffer, phone, ts, mediaMimetype);
                console.log(`[webhook/${instanceId}] Mídia salva em ${localMediaUrl} (${buffer.length} bytes), enviando ao Gemini...`);

                // Transcreve/descreve via Gemini
                return await transcribeMedia(buffer, mediaMimetype, gemKey, kind);
              })(),
              // Timeout por kind: vídeo (download grande) > áudio > documento > imagem
              new Promise<null>((r) => setTimeout(() => r(null),
                kind === "video" ? 60_000 :
                kind === "audio" ? 45_000 :
                kind === "document" ? 40_000 : 25_000
              )),
            ]);

            if (transcribeResult) {
              const prefix = kind === "image" ? "📷" : kind === "video" ? "🎬" : kind === "document" ? "📄" : "🎙️";
              transcribedContent = `${prefix} ${transcribeResult}`;
              console.log(`[webhook/${instanceId}] Transcrição OK kind=${kind}: "${transcribeResult.slice(0, 120)}"`);
            } else {
              console.warn(`[webhook/${instanceId}] Transcrição null/timeout kind=${kind}`);
            }
          } catch (e) {
            console.error(`[webhook/${instanceId}] Erro na transcrição síncrona:`, e instanceof Error ? e.message : e);
          }
        } else {
          console.log(`[webhook/${instanceId}] Sem URL de mídia — não é possível transcrever kind=${kind}`);
        }
      } else {
        console.log(`[webhook/${instanceId}] Sem geminiApiKey — não é possível transcrever`);
      }
    }

    // ── Salva mensagem no histórico ────────────────────────────────────────
    // Se text é uma URL de CDN (colocada pelo UazapiGO no campo body), não salvar como texto —
    // seria confuso no histórico. Usar apenas a transcrição ou o placeholder [tipo].
    const textIsMediaUrl = !!msgType && !!text && (text.startsWith("https://") || text.startsWith("http://") || text.startsWith("data:"));
    const textForContent = textIsMediaUrl ? "" : text;
    const msgContent = transcribedContent || textForContent || (msgType ? `[${msgType}]` : mediaUrl ? "[mídia]" : "");
    const savedType = msgType === "audio" ? "audio" as const : msgType === "image" ? "image" as const : undefined;
    addMessage(phone, { role: fromMe ? "assistant" : "user", content: msgContent, ts, type: savedType, mediaUrl: localMediaUrl ?? mediaUrl }, clientId, { connId: uazConn?.id, contactName: fromMe ? undefined : contactName });

    // Mensagem enviada por você (gestor via WhatsApp ou automação/IA)
    if (fromMe) {
      // Janela de envio ativa: qualquer eco (texto ou mídia) não deve pausar a IA
      if (isPhoneSending(phone)) {
        console.log(`[webhook/${instanceId}] fromMe janela de envio ativa phone=${phone} msgType=${msgType} — não pausa IA`);
        return NextResponse.json({ ok: true });
      }
      // Se a mensagem foi enviada pela própria plataforma (automação/IA), o eco não deve pausar a IA
      const textTrimmed = text.trim();
      console.log(`[webhook/${instanceId}] fromMe=true phone=${phone} textLen=${textTrimmed.length} text="${textTrimmed.slice(0, 80)}"`);
      if (textTrimmed) {
        const consumed = consumeSent(phone, textTrimmed);
        console.log(`[webhook/${instanceId}] consumeSent result=${consumed} phone=${phone} text="${textTrimmed.slice(0, 80)}"`);
        if (consumed) {
          return NextResponse.json({ ok: true }); // eco da plataforma — não pausa IA
        }
      }
      // Mensagem do gestor via celular → pausa a IA
      if (cid !== "sem-cliente") {
        const agCfg = getAgentConfigForConnection(getClientById(cid)!, uazConn?.id);
        const resumeKeyword = agCfg?.aiResumeKeyword?.trim();
        const isPausing = !resumeKeyword || text.trim().toLowerCase() !== resumeKeyword.toLowerCase();
        // Busca o lead real pelo telefone (sem depender de funnelId)
        const existingLead = getLeadByPhone(cid, phone);
        if (existingLead) {
          updateLead(existingLead.id, { aiPaused: isPausing });
        } else {
          upsertLeadByPhone(cid, phone, { funnelId, aiPaused: isPausing });
        }
        setAiPaused(phone, isPausing, cid);
        console.log(`[webhook/${instanceId}] IA ${isPausing ? "PAUSADA" : "REATIVADA"} para phone=${phone} (mensagem do gestor via WhatsApp)`);
      }
      return NextResponse.json({ ok: true });
    }

    // ── Envia mídia na primeira interação do lead ─────────────────────────
    if (isNew && cid !== "sem-cliente") {
      const mediaItems = getAgentConfigForConnection(getClientById(cid)!, uazConn?.id)?.mediaLibrary?.filter((m) => m.sendOnFirstContact) ?? [];
      for (const media of mediaItems) {
        const payload = resolveMediaPayload(media.url);
        await sendMedia(instanceUazToken, phone, media.type, payload, media.caption, media.filename);
        await new Promise<void>((r) => setTimeout(r, 800));
      }
    }

    // ── Follow-ups ───────────────────────────────────────────────────────
    if (cid !== "sem-cliente") {
      const agentCfg = getAgentConfigForConnection(getClientById(cid)!, uazConn?.id);
      if (agentCfg?.followUpEnabled && (agentCfg.followUps?.length ?? 0) > 0) {
        if (isNew) {
          startFollowUpSequence(cid, phone, agentCfg.followUps);
        } else {
          cancelFollowUpsForPhone(cid, phone);
          startFollowUpSequence(cid, phone, agentCfg.followUps);
        }
      }
    }

    const history = getHistory(phone, cid);

    // Verifica se IA está pausada para esta conversa
    const currentLead = getLeadByPhone(cid, phone);
    const convPaused = getAiPaused(phone);
    console.log(`[webhook/${instanceId}] aiPaused check → lead.aiPaused=${currentLead?.aiPaused ?? "null"} conv.aiPaused=${convPaused} phone=${phone} cid=${cid}`);
    if (currentLead?.aiPaused || convPaused) {
      console.log(`[webhook/${instanceId}] IA PAUSADA — ignorando mensagem de phone=${phone}`);
      return NextResponse.json({ ok: true });
    }

    // Agente Kanban — atualiza CRM (fire-and-forget)
    if (cid !== "sem-cliente") {
      processKanbanActions(text, history, cid, phone).catch(() => {});
    }

    // ── Agente IA ─────────────────────────────────────────────────────────
    const activeClient = cid !== "sem-cliente" ? getClientById(cid) : null;
    const connId = uazConn?.id;
    const agentCfg = activeClient ? getAgentConfigForConnection(activeClient, connId) : undefined;
    const geminiEnabled = agentCfg?.enabled === true;
    const waitSeconds = agentCfg?.messageWaitSeconds ?? 0;

    // Filtro de número de teste: se configurado, só responde para aquele número
    if (agentCfg?.testPhone) {
      const testClean = agentCfg.testPhone.replace(/\D/g, "");
      if (phone !== testClean) {
        console.log(`[webhook/${instanceId}] MODO TESTE — ignorando phone=${phone} (permitido: ${testClean})`);
        return NextResponse.json({ ok: true });
      }
    }

    const matchSource = matchedFunnel ? "token-url" : fallbackByBodyToken ? "body-token" : fallbackByBodyName ? "body-name" : fallbackByUrlName ? "url-name" : "sem-funil";
    console.log(`[webhook/${instanceId}] phone=${phone} cid=${cid} funnel=${funnel?.id?.slice(0,8) ?? "none"}(${matchSource}) gemini=${geminiEnabled} wait=${waitSeconds}s uazToken=${instanceUazToken.slice(0, 8)}...`);
    console.log(`[webhook/${instanceId}] agentCfg found=${!!agentCfg} enabled=${agentCfg?.enabled} geminiKey=${agentCfg?.geminiApiKey ? "set" : "empty"} connId=${connId ?? "none"}`);

    // Mensagem a enviar para o Gemini: usa transcrição quando disponível
    const userMsgForAI = transcribedContent || textForContent || (msgType ? `[${msgType}]` : "");

    // Batching: acumula mensagens antes de responder
    if (geminiEnabled && waitSeconds > 0 && cid !== "sem-cliente") {
      const pending = upsertPending(cid, phone, userMsgForAI, waitSeconds);
      const _pendingId = pending.id;

      setTimeout(() => {
        const batch = getPendingForPhone(cid, phone);
        if (!batch || batch.id !== _pendingId || batch.status !== "pending") return;
        markProcessing(batch.id);
        const combined = batch.messages.join("\n");
        const h = getHistory(phone, cid);
        console.log(`[webhook/${instanceId}] Gemini batch iniciando para phone=${phone} cid=${cid} msgs=${batch.messages.length}`);
        runGeminiAgent(combined, h, cid, phone, connId)
          .then(async ({ text: geminiText, actions }) => {
            markDone(batch.id);
            console.log(`[webhook/${instanceId}] Gemini respondeu (${geminiText?.length ?? 0} chars) para ${phone}`);
            const agCfg = getAgentConfigForConnection(getClientById(cid)!, connId);
            const clientName = getClientById(cid)?.name ?? cid;
            if (geminiText) {
              console.log(`[webhook/${instanceId}] Gemini raw (primeiros 300): ${geminiText.slice(0, 300)}`);
              const { clean, names, followup } = extractMediaMarkers(geminiText);
              console.log(`[webhook/${instanceId}] Media markers extraídos: ${JSON.stringify(names)} | library size: ${agCfg?.mediaLibrary?.length ?? 0}`);
              // Salva texto limpo (sem marcadores) no histórico
              addMessage(phone, { role: "assistant", content: clean || geminiText, ts: Date.now() }, clientId, { connId: uazConn?.id });
              const textToSend = clean || geminiText;
              const chunks = agCfg?.splitMessages
                ? splitMessage(textToSend, agCfg.maxMessageLength ?? 300)
                : [textToSend];
              for (let i = 0; i < chunks.length; i++) {
                const sent = await sendText(instanceUazToken, phone, chunks[i]);
                console.log(`[webhook/${instanceId}] sendText[${i + 1}/${chunks.length}] result=${sent} token=${instanceUazToken.slice(0, 8)}... phone=${phone}`);
                if (i < chunks.length - 1) await new Promise<void>((r) => setTimeout(r, 700));
              }
              if (names.length > 0 && agCfg?.mediaLibrary?.length) {
                await sendMarkedMedia(instanceUazToken, phone, names, agCfg.mediaLibrary);
              } else if (names.length > 0) {
                console.warn(`[webhook/${instanceId}] Media markers encontrados mas library vazia! names=${JSON.stringify(names)}`);
              }
              // Envia mensagem após mídias (se houver [APOS_MIDIA:texto])
              if (followup) {
                await new Promise<void>((r) => setTimeout(r, 800));
                await sendText(instanceUazToken, phone, followup);
              }
            }
            if (agCfg && actions.length > 0) {
              await processGeminiActions(actions, instanceUazToken, clientName, agCfg, phone);
            }
          })
          .catch((e) => {
            console.error(`[webhook/${instanceId}] Gemini ERRO para phone=${phone}:`, e);
            markDone(batch.id);
          });
      }, waitSeconds * 1000);

      return NextResponse.json({ ok: true });
    }

    // Resposta imediata (waitSeconds = 0)
    if (cid === "sem-cliente") {
      console.log(`[webhook/${instanceId}] IGNORADO — cliente não identificado (cid=sem-cliente) phone=${phone} instanceId=${instanceId}`);
      console.log(`[webhook/${instanceId}] Funis disponíveis:`, funnels.map(f => ({ id: f.id, name: f.name, clientId: f.clientId, conns: f.connections?.map(c => ({ id: c.id, type: c.type, token: c.uazapiToken?.slice(0,8) })) })));
      return NextResponse.json({ ok: true });
    }
    if (!geminiEnabled) {
      console.log(`[webhook/${instanceId}] IGNORADO — Gemini não habilitado. agentCfg=${JSON.stringify({ found: !!agentCfg, enabled: agentCfg?.enabled, connId, clientAgentConfigs: activeClient?.agentConfigs?.length ?? 0, hasLegacyAgentConfig: !!activeClient?.agentConfig })}`);
      return NextResponse.json({ ok: true });
    }

    console.log(`[webhook/${instanceId}] Gemini imediato iniciando para phone=${phone} cid=${cid} connId=${connId ?? "none"} userMsg="${userMsgForAI.slice(0, 80)}"`);
    const { text: geminiText, actions: geminiActions } = await runGeminiAgent(userMsgForAI, history, cid, phone, connId);
    console.log(`[webhook/${instanceId}] Gemini imediato respondeu chars=${geminiText?.length ?? 0} actions=${geminiActions.length}`);
    if (!geminiText && geminiActions.length === 0) {
      console.log(`[webhook/${instanceId}] Gemini retornou vazio — sem resposta enviada`);
      return NextResponse.json({ ok: true });
    }

    if (geminiText) {
      console.log(`[webhook/${instanceId}] Gemini raw (primeiros 300): ${geminiText.slice(0, 300)}`);
      const { clean, names, followup } = extractMediaMarkers(geminiText);
      console.log(`[webhook/${instanceId}] Media markers extraídos: ${JSON.stringify(names)} | library size: ${agentCfg?.mediaLibrary?.length ?? 0}`);
      // Salva texto limpo (sem marcadores) no histórico
      addMessage(phone, { role: "assistant", content: clean || geminiText, ts: Date.now() }, clientId, { connId: uazConn?.id });
      const textToSend = clean || geminiText;
      const chunks = agentCfg?.splitMessages
        ? splitMessage(textToSend, agentCfg.maxMessageLength ?? 300)
        : [textToSend];
      for (let i = 0; i < chunks.length; i++) {
        const sent = await sendText(instanceUazToken, phone, chunks[i]);
        console.log(`[webhook/${instanceId}] sendText[${i + 1}/${chunks.length}] result=${sent}`);
        if (i < chunks.length - 1) await new Promise<void>((r) => setTimeout(r, 700));
      }
      if (names.length > 0 && agentCfg?.mediaLibrary?.length) {
        await sendMarkedMedia(instanceUazToken, phone, names, agentCfg.mediaLibrary);
      } else if (names.length > 0) {
        console.warn(`[webhook/${instanceId}] Media markers encontrados mas library vazia! names=${JSON.stringify(names)}`);
      }
      // Envia mensagem após mídias (se houver [APOS_MIDIA:texto])
      if (followup) {
        await new Promise<void>((r) => setTimeout(r, 800));
        await sendText(instanceUazToken, phone, followup);
      }
    }
    if (agentCfg && geminiActions.length > 0) {
      const clientName = getClientById(cid)?.name ?? cid;
      await processGeminiActions(geminiActions, instanceUazToken, clientName, agentCfg, phone);
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(`[webhook/${instanceId}] Erro:`, err);
    return NextResponse.json({ ok: true }); // sempre 200 para evitar reenvios
  }
}

export async function GET() {
  return NextResponse.json({ status: "online", webhook: "per-instance" });
}
