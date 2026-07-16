import { NextRequest, NextResponse } from "next/server";
import { readFileSync, existsSync, writeFileSync, mkdirSync } from "fs";
import path from "path";
import { getEvolutionSessionById } from "@/lib/evolution-sessions";
import { getFunnels } from "@/lib/funnels";
import { getLeads, getLeadByPhone, upsertLeadByPhone, updateLead, deleteLead, markLeadNeedsAttention, normalizePhone } from "@/lib/leads";
import { getConfig, getClientById, getAgentConfigForConnection } from "@/lib/clients";
import { getAdInfoById } from "@/lib/meta-api";
import { getHistory, addMessage, setAiPaused, sanitizeContactName } from "@/lib/conversations";
import { markSent, consumeSent, isPhoneSending, markPhoneSending } from "@/lib/wppconnect-sent";
import { splitMessage } from "@/lib/uazapi";
import { runGeminiAgent } from "@/lib/gemini-agent";
import { processKanbanActions } from "@/lib/kanban-agent";
import {
  sendText as evoSendText,
  sendMedia as evoSendMedia,
  sendMediaFromBase64,
  resolveContactPhone,
  getContactName,
  startTyping,
  stopTyping,
  getBase64FromMediaMessage,
} from "@/lib/evolution-api";
import { setCachedQr } from "@/lib/evolution-qr";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { getGeminiApiKey } from "@/lib/whatsapp-send";
import { transcribeMedia } from "@/lib/media-transcribe";
import { extractAndWriteToSheet } from "@/lib/sheet-extractor";
import { filterUnsentMedia, markMediaSent } from "@/lib/media-sent-tracker";
import type { AgentConfig, AgentMedia } from "@/lib/clients";
import type { GeminiAction } from "@/lib/gemini-agent";
import { runAutomationsForMessage } from "@/lib/crm-automations";
import { startFollowUpSequence, cancelFollowUpsForPhone } from "@/lib/followups";
import {
  upsertPending,
  getPendingForPhone,
  markProcessing,
  markDone,
  cancelPendingForPhone,
} from "@/lib/pending-responses";

export const dynamic = "force-dynamic";

// Rastreia telefones de leads que vieram via CTWa (Click-to-WhatsApp).
// Quando o cliente chega primeiro (race condition), o fromMe da saudação automática
// do WA Business é identificado pelo adId — não por janela de tempo.
// Mesmo padrão do webhook do WPPConnect (Set independente — cada provider tem o seu).
const ctwaLeadSet = new Set<string>();

// ── Extrai marcadores [MIDIA:nome] e [APOS_MIDIA:texto] do texto da IA ──
// Cópia exata da função equivalente em webhook/wppconnect/[token]/route.ts —
// função pura, sem chamadas de API, sem acoplamento a nenhum provider.
function extractMediaMarkers(text: string): { clean: string; names: string[]; followup?: string } {
  const followupPattern = /\[APOS_MIDIA:([\s\S]*?)\]/i;
  const followupMatch = text.match(followupPattern);
  const followup = followupMatch ? followupMatch[1].trim() : undefined;
  const textWithoutFollowup = text.replace(followupPattern, "").trim();

  const pattern = /\[MIDIA:([^\]]+)\]/gi;
  const names: string[] = [];
  const clean = textWithoutFollowup.replace(pattern, (_, name: string) => {
    names.push(name.trim().toLowerCase());
    return "";
  }).replace(/[ \t]{2,}/g, " ").trim();
  return { clean, names, followup };
}

// ── Envia mídias marcadas via Evolution ──
async function sendEvolutionMarkedMedia(
  instanceName: string,
  instanceApiKey: string,
  phone: string,
  names: string[],
  library: AgentMedia[],
  isLid: boolean,
): Promise<void> {
  const libraryNames = library.map((m) => m.name?.toLowerCase());
  for (const name of names) {
    const media = library.find((m) => m.name?.toLowerCase() === name);
    if (!media) {
      console.warn(`[Evolution sendEvolutionMarkedMedia] Mídia "${name}" não encontrada. Library: ${JSON.stringify(libraryNames)}`);
      continue;
    }
    try {
      const rawPhone = phone.replace(/@.*$/, "").replace(/\D/g, "");
      markPhoneSending(rawPhone);

      const localMatch = media.url.match(/\/api\/uploads\/([^/?#]+)$/);
      if (localMatch) {
        const filePath = path.join(process.cwd(), "data", "uploads", localMatch[1]);
        if (!existsSync(filePath)) {
          console.warn(`[Evolution sendEvolutionMarkedMedia] Arquivo não encontrado: ${filePath}`);
          continue;
        }
        const buffer = readFileSync(filePath);
        const ext = localMatch[1].split(".").pop()?.toLowerCase() ?? "";
        const mimeMap: Record<string, string> = {
          jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png",
          gif: "image/gif", webp: "image/webp", mp4: "video/mp4",
          pdf: "application/pdf",
        };
        const mime = mimeMap[ext] ?? "application/octet-stream";
        const base64DataUri = `data:${mime};base64,${buffer.toString("base64")}`;
        const result = await sendMediaFromBase64(instanceName, instanceApiKey, phone, base64DataUri, mime, media.caption, isLid);
        console.log(`[Evolution sendEvolutionMarkedMedia] "${name}" (base64 local) result=${result}`);
      } else {
        const result = await evoSendMedia(instanceName, instanceApiKey, phone, media.url, media.caption, isLid);
        console.log(`[Evolution sendEvolutionMarkedMedia] "${name}" (url externa) result=${result}`);
      }
    } catch (e) {
      console.error(`[Evolution sendEvolutionMarkedMedia] Erro ao enviar "${name}":`, e);
    }
    await new Promise<void>((r) => setTimeout(r, 700));
  }
}

// ── Resumo de conversa via Evolution ──

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

async function generateEvolutionSummaryText(
  clientName: string,
  agCfg: AgentConfig,
  phone: string,
  motivo: string,
  clientId: string,
  connId: string,
): Promise<string> {
  const history = getHistory(phone, clientId, connId);
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

    for (const modelId of ["gemini-3.1-flash-lite", "gemini-2.5-flash"]) {
      try {
        const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), 12_000));
        const model = genAI.getGenerativeModel({ model: modelId });
        const result = await Promise.race([model.generateContent(prompt), timeout]);
        if (result) {
          const text = (result as Awaited<ReturnType<typeof model.generateContent>>).response.text().trim();
          if (text) {
            console.log(`[evolution-summary] sucesso modelo=${modelId}`);
            return text;
          }
        } else {
          console.warn(`[evolution-summary] timeout modelo=${modelId}`);
        }
      } catch (e) {
        console.error(`[evolution-summary] ${modelId} falhou:`, e);
      }
    }
  }
  return buildBasicSummary(history);
}

async function processEvolutionActions(
  actions: GeminiAction[],
  instanceName: string,
  instanceApiKey: string,
  clientName: string,
  agCfg: AgentConfig,
  leadPhone: string,
  isLid: boolean,
  clientId: string,
  connId: string,
): Promise<void> {
  for (const action of actions) {
    if (action.type === "resumo_solicitado") {
      markLeadNeedsAttention(clientId, leadPhone, undefined, action.motivo);

      const recipients = agCfg.avisos?.length
        ? agCfg.avisos
        : agCfg.summaryPhone
          ? [{ id: "legacy", label: "Gestor", value: agCfg.summaryPhone, type: "phone" as const }]
          : [];

      if (recipients.length === 0) {
        console.log("[evolution-summary] Nenhum destinatário de avisos configurado — resumo ignorado");
        continue;
      }

      const resumo = await generateEvolutionSummaryText(clientName, agCfg, leadPhone, action.motivo, clientId, connId);
      const lead = getLeadByPhone(clientId, leadPhone);
      const displayPhone = (lead?.realPhone ?? leadPhone).replace(/\D/g, "");
      const waLink = `https://wa.me/${displayPhone}`;
      const msg =
        `📋 *Resumo de conversa — ${clientName}*\n\n` +
        `📞 *Lead:* ${waLink}\n` +
        `📝 *Motivo:* ${action.motivo}\n\n` +
        `${resumo}`;

      console.log(`[evolution-summary] Enviando aviso para ${recipients.length} destinatário(s)`);
      await Promise.all(
        recipients.map((r) => {
          console.log(`[evolution-summary] → ${r.label} (${r.type}) ${r.value}`);
          return evoSendText(instanceName, instanceApiKey, r.value, msg, false);
        })
      );
    }
  }
}

// ── Parsing do payload da Evolution (shape Baileys, aninhado em body.data) ──
// Diferente do WPPConnect (campos soltos na raiz do body), a Evolution sempre
// entrega { event, instance, data: { key, message, messageType, ... } }.
type EvolutionMessageData = {
  key?: { remoteJid?: string; fromMe?: boolean; id?: string };
  pushName?: string;
  message?: Record<string, unknown>;
  messageType?: string;
  messageTimestamp?: number | string;
};

// Acha o objeto de mídia dentro de data.message (imageMessage/videoMessage/
// audioMessage/documentMessage/stickerMessage) e seu contextInfo, se houver —
// o contextInfo (onde a Evolution costuma expor dados de anúncio CTWa) fica
// aninhado DENTRO do objeto do tipo específico, não solto em data.message.
function findMessageTypeObject(message: Record<string, unknown> | undefined): { type: string; obj: Record<string, unknown> } | null {
  if (!message) return null;
  const candidates = ["imageMessage", "videoMessage", "audioMessage", "documentMessage", "stickerMessage", "extendedTextMessage"];
  for (const key of candidates) {
    const obj = message[key];
    if (obj && typeof obj === "object") return { type: key, obj: obj as Record<string, unknown> };
  }
  return null;
}

function findContextInfo(message: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  const found = findMessageTypeObject(message);
  const ctx = found?.obj?.contextInfo;
  return (ctx && typeof ctx === "object") ? ctx as Record<string, unknown> : undefined;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;

  const evoSession = getEvolutionSessionById(token);
  console.log(`[EVO-DIAG] token=${token} session=${evoSession?.id ?? "NOT_FOUND"} funnelId=${evoSession?.funnelId ?? "null"} clientId=${evoSession?.clientId ?? "null"}`);
  if (!evoSession) {
    console.log(`[Evolution Webhook] token=${token} ignorado (sessão inexistente)`);
    return NextResponse.json({ ok: true });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json() as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: true });
  }

  const eventRaw = String(body.event ?? "");
  const event = eventRaw.toLowerCase().replace(/\./g, "_"); // normaliza "qrcode.updated"/"QRCODE_UPDATED" → "qrcode_updated"
  const evoData = (body.data ?? {}) as Record<string, unknown>;

  // ── Evento de QR: precisa ser cacheado mesmo ANTES da sessão ter funil
  // vinculado — igual ao WPPConnect, é durante a criação/conexão que esse
  // cache é mais necessário como fallback do GET /instance/connect.
  if (event === "qrcode_updated") {
    const qrcodeObj = (evoData.qrcode ?? evoData) as Record<string, unknown>;
    const base64Raw = qrcodeObj.base64 as string | undefined;
    const code = (qrcodeObj.code as string | undefined) ?? (qrcodeObj.pairingCode as string | undefined) ?? "";
    if (base64Raw) {
      const qrDataUri = base64Raw.startsWith("data:") ? base64Raw : `data:image/png;base64,${base64Raw}`;
      setCachedQr(evoSession.instanceName, qrDataUri, code);
    }
    return NextResponse.json({ ok: true });
  }

  if (!evoSession.funnelId) {
    console.log(`[Evolution Webhook] token=${token} ignorado (sessão sem funil)`);
    return NextResponse.json({ ok: true });
  }

  // ── DEBUG: captura os últimos eventos recebidos (qualquer tipo/evento) ──
  try {
    const debugEventsFile = path.join(process.cwd(), "data", "debug-evolution-events.json");
    const existingEvents: unknown[] = existsSync(debugEventsFile)
      ? (JSON.parse(readFileSync(debugEventsFile, "utf-8")) as unknown[])
      : [];
    existingEvents.unshift({
      ts: new Date().toISOString(),
      instance: evoSession.instanceName,
      event: eventRaw,
      fromMe: evoData.key ? (evoData.key as Record<string, unknown>).fromMe : undefined,
      messageType: evoData.messageType,
      remoteJid: evoData.key ? (evoData.key as Record<string, unknown>).remoteJid : undefined,
    });
    if (existingEvents.length > 30) existingEvents.length = 30;
    writeFileSync(debugEventsFile, JSON.stringify(existingEvents, null, 2));
  } catch { /* debug only */ }

  // Só processa upsert de mensagens — resto (CONNECTION_UPDATE, CONTACTS_UPSERT
  // etc.) é logado acima e descartado, igual ao filtro de evento do WPPConnect.
  if (event !== "messages_upsert") {
    if (eventRaw) console.log(`[Evolution Webhook] evento filtrado: event=${eventRaw} instance=${evoSession.instanceName}`);
    return NextResponse.json({ ok: true });
  }

  const data = evoData as EvolutionMessageData;
  const key = data.key ?? {};
  const fromMe = key.fromMe === true;
  const remoteJid = key.remoteJid ?? "";

  // Ignora grupos
  if (remoteJid.endsWith("@g.us")) return NextResponse.json({ ok: true });

  // ── Ignora mensagens históricas do sync de reconexão ──
  // Baileys normalmente entrega messageTimestamp em SEGUNDOS — normalizamos
  // do mesmo jeito defensivo que o WPPConnect, por segurança.
  let msgTimestamp = Number(data.messageTimestamp ?? 0);
  if (msgTimestamp > 1_000_000_000_000) msgTimestamp = Math.floor(msgTimestamp / 1000);
  const nowSec = Math.floor(Date.now() / 1000);
  if (msgTimestamp > 0) {
    const ageSec = nowSec - msgTimestamp;
    if (ageSec > 300 || ageSec < -30) {
      console.log(`[Evolution Webhook] histórico ignorado: remoteJid=${remoteJid} age=${ageSec}s ts=${msgTimestamp}`);
      return NextResponse.json({ ok: true });
    }
  }

  const isLidContact = remoteJid.endsWith("@lid");
  const phone = remoteJid.replace(/@.*/, "").replace(/\D/g, "");
  if (!phone) return NextResponse.json({ ok: true });

  console.log(`[Evolution Webhook] phone extraído: ${phone} (remoteJid=${remoteJid} fromMe=${fromMe})`);

  // ── Detecta tipo de mensagem e extrai texto/mídia ──
  const messageObj = data.message ?? {};
  const typeInfo = findMessageTypeObject(messageObj);
  // messageType da Evolution costuma refletir o nome da chave de data.message
  // (ex: "imageMessage") — usamos como confirmação, mas o "obj" já encontrado
  // acima é a fonte de verdade quando os dois divergem.
  const msgType = typeInfo?.type ?? (typeof messageObj.conversation === "string" ? "conversation" : String(data.messageType ?? ""));

  let text = "";
  let contentForHistory = "";
  let mediaBuffer: Buffer | undefined;
  let mediaMime = "";
  let mediaKind: "audio" | "image" | "video" | "document" | undefined;
  // ⚠️ NÃO CONFIRMADO AO VIVO — distinção ptt (voz) vs audioMessage comum:
  // no protocolo Baileys, audioMessage.ptt === true identifica nota de voz.
  const isPtt = typeInfo?.type === "audioMessage" && (typeInfo.obj.ptt === true);

  if (msgType === "conversation") {
    text = String(messageObj.conversation ?? "");
    contentForHistory = text;
  } else if (typeInfo?.type === "extendedTextMessage") {
    text = String(typeInfo.obj.text ?? "");
    contentForHistory = text;
  } else if (typeInfo?.type === "imageMessage") {
    const caption = String(typeInfo.obj.caption ?? "");
    contentForHistory = `[Imagem]${caption ? `: ${caption}` : ""}`;
    // ⚠️ Base64 inline não confirmado — ver getBase64FromMediaMessage abaixo,
    // chamado depois se este campo não vier preenchido pelo webhook.
    const inlineBase64 = typeInfo.obj.base64 as string | undefined;
    if (inlineBase64) {
      mediaBuffer = Buffer.from(inlineBase64, "base64");
      mediaMime = String(typeInfo.obj.mimetype ?? "image/jpeg");
      mediaKind = "image";
    }
    text = caption || contentForHistory;
  } else if (typeInfo?.type === "audioMessage") {
    const dur = typeInfo.obj.seconds ? ` de ${Math.round(Number(typeInfo.obj.seconds))}s` : "";
    contentForHistory = `[Áudio${dur}]`;
    const inlineBase64 = typeInfo.obj.base64 as string | undefined;
    if (inlineBase64) {
      mediaBuffer = Buffer.from(inlineBase64, "base64");
      mediaMime = String(typeInfo.obj.mimetype ?? "audio/ogg");
      mediaKind = "audio";
    }
    text = contentForHistory;
  } else if (typeInfo?.type === "videoMessage") {
    const caption = String(typeInfo.obj.caption ?? "");
    contentForHistory = `[Vídeo]${caption ? `: ${caption}` : ""}`;
    text = caption || "[O usuário enviou um vídeo]";
  } else if (typeInfo?.type === "documentMessage") {
    const fname = String(typeInfo.obj.fileName ?? typeInfo.obj.caption ?? "arquivo");
    contentForHistory = `[Documento: ${fname}]`;
    text = `[O usuário enviou um documento: ${fname}]`;
  } else if (typeInfo?.type === "stickerMessage") {
    contentForHistory = "[Sticker]";
    text = "[O usuário enviou um sticker/figurinha]";
  } else {
    // Tipo não mapeado (reação, enquete, etc.) — ignora silenciosamente.
    return NextResponse.json({ ok: true });
  }

  // ── Busca mídia por id quando o webhook não trouxe base64 inline ──
  const isMediaMsg = mediaKind === undefined && (typeInfo?.type === "imageMessage" || typeInfo?.type === "audioMessage");
  if (isMediaMsg && key.id) {
    const fetched = await getBase64FromMediaMessage(evoSession.instanceName, evoSession.instanceApiKey, key.id).catch(() => null);
    if (fetched) {
      mediaBuffer = Buffer.from(fetched.base64, "base64");
      mediaMime = fetched.mimetype || (typeInfo?.type === "audioMessage" ? "audio/ogg" : "image/jpeg");
      mediaKind = typeInfo?.type === "audioMessage" ? "audio" : "image";
    } else {
      text = typeInfo?.type === "audioMessage"
        ? "[O usuário enviou um áudio. Não foi possível processar — peça para digitar.]"
        : (text || "[O usuário enviou uma imagem]");
    }
  }

  const pushName = data.pushName || phone;

  // ── CTWa: dados de anúncio (Click-to-WhatsApp) ──
  // ⚠️ CAMPO NÃO CONFIRMADO AO VIVO — a Evolution/Baileys costuma expor isso em
  // contextInfo.externalAdReplyInfo dentro do objeto de mensagem específico.
  // Log completo do contextInfo abaixo (leads novos) para confirmar nomes de
  // campo reais assim que chegar um clique de anúncio de verdade.
  const isNewPhone = !getLeadByPhone(
    (getFunnels().find(f => f.id === evoSession.funnelId)?.clientId ?? evoSession.clientId ?? "sem-cliente"),
    phone,
    evoSession.funnelId ?? undefined,
  );
  const contextInfo = findContextInfo(messageObj);
  if (isNewPhone && !fromMe) {
    console.log(`[Evolution CTWa DIAG] NOVO LEAD phone=${phone} messageType=${msgType} contextInfo=${JSON.stringify(contextInfo)}`);
    try {
      const debugFile = path.join(process.cwd(), "data", "debug-evolution-webhook-payloads.json");
      mkdirSync(path.dirname(debugFile), { recursive: true });
      const existing: unknown[] = existsSync(debugFile)
        ? (JSON.parse(readFileSync(debugFile, "utf-8")) as unknown[])
        : [];
      existing.unshift({ ts: new Date().toISOString(), phone, instance: evoSession.instanceName, messageType: msgType, contextInfo });
      if (existing.length > 50) existing.length = 50;
      writeFileSync(debugFile, JSON.stringify(existing, null, 2));
    } catch (e) {
      console.warn("[Evolution CTWa DIAG] Erro ao salvar debug file:", e);
    }
  }

  const externalAd = contextInfo?.externalAdReplyInfo as Record<string, unknown> | undefined;
  let ctwaAdId = ((externalAd?.sourceId ?? externalAd?.source_id) as string | undefined) || (contextInfo?.ctwaClid as string | undefined) || undefined;
  const ctwaSourceUrl = ((externalAd?.sourceUrl ?? externalAd?.source_url) as string | undefined) || undefined;
  const ctwaHeadline = (externalAd?.title as string | undefined) || undefined;

  // Mesma cadeia de regex do WPPConnect para extrair o Ad ID da source_url —
  // função pura, sem chamadas de API, sem acoplamento a nenhum provider.
  if (!ctwaAdId && ctwaSourceUrl) {
    const urlAdIdMatch =
      ctwaSourceUrl.match(/[?&]adId=(\d+)/i) ||
      ctwaSourceUrl.match(/\/ads\/adId=(\d+)/i) ||
      ctwaSourceUrl.match(/fb\.me\/ads\/(\d+)/i) ||
      ctwaSourceUrl.match(/\/ads\/(\d{10,})/i);
    if (urlAdIdMatch) {
      ctwaAdId = urlAdIdMatch[1];
      console.log(`[Evolution CTWa] Ad ID extraído da source_url: ${ctwaAdId}`);
    }
  }

  // Mesmo fallback de resolução de redirect fb.me do WPPConnect.
  if (!ctwaAdId && ctwaSourceUrl && /fb\.me\//.test(ctwaSourceUrl)) {
    try {
      const resp = await fetch(ctwaSourceUrl, { method: "HEAD", redirect: "follow", signal: AbortSignal.timeout(3000) });
      const resolvedUrl = resp.url;
      if (resolvedUrl && resolvedUrl !== ctwaSourceUrl) {
        const resolvedMatch =
          resolvedUrl.match(/[?&]adId=(\d+)/i) ||
          resolvedUrl.match(/\/ads\/adId=(\d+)/i) ||
          resolvedUrl.match(/fb\.me\/ads\/(\d+)/i) ||
          resolvedUrl.match(/\/ads\/(\d{10,})/i) ||
          resolvedUrl.match(/[?&]ad_id=(\d+)/i);
        if (resolvedMatch) {
          ctwaAdId = resolvedMatch[1];
          console.log(`[Evolution CTWa] Ad ID extraído da URL resolvida (${resolvedUrl}): ${ctwaAdId}`);
        }
      }
    } catch (e) {
      console.warn("[Evolution CTWa] Erro ao resolver fb.me redirect:", e instanceof Error ? e.message : e);
    }
  }

  if (externalAd) {
    console.log(`[Evolution CTWa] referral detectado — source_id=${ctwaAdId} headline="${ctwaHeadline}" source_url=${ctwaSourceUrl}`);
  }

  // ── Encontra o funil vinculado (mesma lógica de reaproveitamento cross-funil do WPPConnect) ──
  const funnels = getFunnels();
  const funnel = funnels.find(f => f.id === evoSession.funnelId);
  const defaultFunnelId = funnel?.id ?? evoSession.funnelId!;
  const clientId = evoSession.clientId ?? funnel?.clientId ?? "sem-cliente";
  const connId = evoSession.id;

  const leadInDefaultFunnel = getLeadByPhone(clientId, phone, defaultFunnelId);
  const leadElsewhere = leadInDefaultFunnel ? null : getLeadByPhone(clientId, phone);
  const hasHistoryOnThisConn = !!leadElsewhere && getHistory(phone, clientId, connId).length > 0;
  const existingLeadAnyFunnel = leadInDefaultFunnel ?? (hasHistoryOnThisConn ? leadElsewhere : null);
  const funnelId = existingLeadAnyFunnel?.funnelId ?? defaultFunnelId;
  const funnelForEntrada = funnelId === defaultFunnelId ? funnel : funnels.find(f => f.id === funnelId);
  const entradaColumnId = funnelForEntrada?.columns?.[0]?.id ?? "entrada";

  const existingLead = existingLeadAnyFunnel;
  const isNew = !existingLead;
  const shouldUpdateName = !fromMe && (isNew || existingLead?.name === phone);

  let contactNameFromApi: string | undefined;
  if (fromMe && isNew) {
    const fetched = await getContactName(evoSession.instanceName, evoSession.instanceApiKey, phone);
    if (fetched) contactNameFromApi = fetched;
  }
  const nameToSave = contactNameFromApi ?? (shouldUpdateName ? pushName : undefined);

  // ── Lookup no Meta Ads API para enriquecer dados de campanha ──
  let adInfo: Awaited<ReturnType<typeof getAdInfoById>> = null;
  const shouldLookupAd = !!ctwaAdId && (!existingLead?.adId || existingLead.adId !== ctwaAdId);
  if (shouldLookupAd) {
    try {
      const cfg = getConfig();
      if (cfg.metaToken) {
        adInfo = await getAdInfoById(ctwaAdId!, cfg.metaToken);
        console.log(`[Evolution CTWa] Meta API result: campaign="${adInfo?.campaignName}" adSet="${adInfo?.adSetName}" ad="${adInfo?.adName}"`);
      } else {
        console.warn("[Evolution CTWa] metaToken não configurado — não foi possível resolver campanha via Meta API");
      }
    } catch (e) {
      console.warn("[Evolution CTWa] Erro ao chamar Meta API:", e instanceof Error ? e.message : e);
    }
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
    : ctwaAdId || ctwaHeadline || ctwaSourceUrl
    ? {
        adPlatform: "meta" as const,
        adId: ctwaAdId ?? null,
        adName: null,
        adSetId: null,
        adSetName: null,
        campaignId: null,
        campaignName: ctwaHeadline ?? null,
        adSourceUrl: ctwaSourceUrl ?? null,
      }
    : {};

  // ── Proteção contra criação de leads falsos no history sync do reconnect ──
  if (isNew && msgTimestamp === 0) {
    console.log(`[EVO-DIAG] BLOQUEADO: sem timestamp + lead novo phone=${phone}`);
    return NextResponse.json({ ok: true });
  }

  // Evolution/Baileys não tem um equivalente conhecido ao mark-unseen do
  // WPPConnect nesta fase (ver evolution-api.ts) — passo omitido aqui.

  // ── 1. Grava o lead IMEDIATAMENTE ──
  const savedLead = upsertLeadByPhone(clientId, phone, {
    clientId,
    funnelId,
    source: "whatsapp",
    ...(nameToSave ? { name: nameToSave } : {}),
    ...(isNew ? { status: entradaColumnId } : {}),
    ...(isLidContact ? { isLid: true } : {}),
    ...adFields,
  });

  // ── 2. Resolve o número real do LID em background ──
  // resolveContactPhone da Evolution retorna sempre null nesta fase (ver
  // evolution-api.ts) — mantido pelo mesmo contrato defensivo do WPPConnect
  // para não quebrar quando/se um endpoint equivalente for confirmado.
  const needsPhoneResolution = isLidContact && !savedLead.realPhone;
  if (needsPhoneResolution) {
    resolveContactPhone()
      .then((realPhone) => {
        if (realPhone && realPhone !== phone) {
          console.log(`[Evolution Webhook] LID ${phone} → número real: ${realPhone}`);
          updateLead(savedLead.id, { realPhone });
          const allLeads = getLeads(clientId);
          const normalizedRealPhone = normalizePhone(realPhone);
          for (const dup of allLeads) {
            if (dup.id !== savedLead.id && normalizePhone(dup.phone) === normalizedRealPhone) {
              console.log(`[Evolution Webhook] Removendo duplicata com phone=${dup.phone} (LID já resolvido)`);
              deleteLead(dup.id);
            }
          }
        }
      })
      .catch((e) => console.log(`[Evolution Webhook] LID ${phone} erro ao resolver: ${e}`));
  }

  if (ctwaAdId) {
    console.log(`[Evolution Webhook] CTWa lead phone=${phone} adId=${ctwaAdId} adInfo=${JSON.stringify(adInfo)}`);
  }

  // ── Salva a mensagem na conversa (somente mensagens recebidas do lead) ──
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

  if (ctwaAdId && !fromMe) {
    ctwaLeadSet.add(phone);
  }

  // ── Mensagem enviada por nós (IA, plataforma ou operador pelo celular) ──
  if (fromMe) {
    // audioMessage com ptt=true: a plataforma nunca envia áudio automaticamente
    // — é sempre o operador pelo celular. Mesmo raciocínio do ptt/audio do WPPConnect.
    const isOperatorOnlyMedia = isPtt;

    if (!isOperatorOnlyMedia) {
      if (text.trim()) {
        const consumed = consumeSent(phone, text.trim());
        console.log(`[Evolution fromMe] phone=${phone} consumed=${consumed} text="${text.trim().slice(0, 80)}"`);
        if (consumed) return NextResponse.json({ ok: true });
      }

      if (isPhoneSending(phone)) {
        console.log(`[Evolution fromMe] phone=${phone} janela de envio ativa — não pausa IA`);
        return NextResponse.json({ ok: true });
      }

      if (text.trim()) {
        const isCTWaGreeting = ctwaLeadSet.has(phone);
        if (isCTWaGreeting) {
          ctwaLeadSet.delete(phone);
          console.log(`[Evolution fromMe] phone=${phone} — saudação automática (CTWa identificado via adId), não pausa IA`);
          addMessage(phone, { role: "assistant", content: text, ts: Date.now() }, clientId, { connId });
          return NextResponse.json({ ok: true });
        }
      }
    }

    if (text.trim()) {
      console.log(`[Evolution fromMe] phone=${phone} msgType=${msgType} — operador enviou mídia/texto, pausando IA`);
      addMessage(phone, { role: "assistant", content: text, ts: Date.now() }, clientId, { connId });
      const activeClientFM = clientId !== "sem-cliente" ? getClientById(clientId) : null;
      const agentCfgFM = activeClientFM ? getAgentConfigForConnection(activeClientFM, connId) : undefined;
      const resumeKeyword = agentCfgFM?.aiResumeKeyword?.trim();
      const isPausing = !(resumeKeyword && text.trim().toLowerCase() === resumeKeyword.toLowerCase());
      setAiPaused(phone, isPausing, clientId);
      const freshLead = getLeadByPhone(clientId, phone, funnelId);
      if (freshLead) updateLead(freshLead.id, { aiPaused: isPausing });
      if (clientId !== "sem-cliente" && agentCfgFM?.followUpEnabled && (agentCfgFM.followUps?.length ?? 0) > 0) {
        cancelFollowUpsForPhone(clientId, phone);
        startFollowUpSequence(clientId, phone, agentCfgFM.followUps, connId);
      }
    }
    return NextResponse.json({ ok: true });
  }
  if (!text.trim() && !contentForHistory.trim()) return NextResponse.json({ ok: true });

  // ── Agente Kanban — roda sempre, independente da IA de atendimento ──
  if (clientId !== "sem-cliente") {
    const _h = getHistory(phone, clientId, connId);
    const historyForKanban = _h.length > 1 ? _h.slice(0, -1) : [];
    processKanbanActions(text, historyForKanban, clientId, phone).catch(() => {});
  }

  // ── Follow-ups: agenda quando lead responde, independente de IA ──
  if (clientId !== "sem-cliente") {
    const activeClientFU = getClientById(clientId);
    const agentCfgFU = activeClientFU ? getAgentConfigForConnection(activeClientFU, connId) : undefined;
    if (agentCfgFU?.followUpEnabled && (agentCfgFU.followUps?.length ?? 0) > 0) {
      cancelFollowUpsForPhone(clientId, phone);
      startFollowUpSequence(clientId, phone, agentCfgFU.followUps, connId);
    }
  }

  // ── Verifica IA ──
  const currentLead = getLeadByPhone(clientId, phone, funnelId);
  if (currentLead?.aiPaused) {
    console.log(`[Evolution IA] phone=${phone} clientId=${clientId} — IA pausada (aiPaused=true)`);
    return NextResponse.json({ ok: true });
  }

  const activeClient = clientId !== "sem-cliente" ? getClientById(clientId) : null;
  const agentCfg = activeClient ? getAgentConfigForConnection(activeClient, connId) : undefined;
  const geminiEnabled = agentCfg?.enabled === true;

  if (!geminiEnabled || clientId === "sem-cliente") {
    console.log(`[Evolution IA] IA desligada — geminiEnabled=${geminiEnabled} clientId=${clientId}`);
    return NextResponse.json({ ok: true });
  }

  // testPhone: quando configurado, IA responde APENAS este número
  if (agentCfg?.testPhone) {
    const phoneNorm = normalizePhone(phone);
    const testNorm = normalizePhone(agentCfg.testPhone);
    if (phoneNorm !== testNorm) {
      console.log(`[Evolution IA] phone=${phone} bloqueado — testPhone=${agentCfg.testPhone} norm_phone=${phoneNorm} norm_test=${testNorm} (modo teste ativo)`);
      return NextResponse.json({ ok: true });
    }
  }

  // ── Transcreve áudio/imagem ANTES do agente ──
  if (mediaBuffer && mediaMime && mediaKind) {
    const apiKey = getGeminiApiKey(agentCfg?.geminiApiKey ?? undefined);
    if (apiKey) {
      try {
        const transcription = await transcribeMedia(mediaBuffer, mediaMime, apiKey, mediaKind);
        if (transcription) text = transcription;
      } catch (e) {
        console.error("[Evolution Webhook] Erro na transcrição de mídia:", e);
      }
    }
  }

  const waitSeconds = agentCfg?.messageWaitSeconds ?? 0;
  const history = getHistory(phone, clientId, connId);

  const instanceSnap = evoSession.instanceName;
  const apiKeySnap = evoSession.instanceApiKey;
  startTyping(instanceSnap, apiKeySnap, phone).catch(() => {});
  const typingInterval = setInterval(() => {
    startTyping(instanceSnap, apiKeySnap, phone).catch(() => {});
  }, 3000);

  console.log(`[Evolution IA] Chamando runGeminiAgent — phone=${phone} clientId=${clientId} waitSeconds=${waitSeconds} historyLen=${history.length}`);

  async function sendReply(reply: string) {
    clearInterval(typingInterval);
    stopTyping(instanceSnap, apiKeySnap, phone).catch(() => {});
    const { clean, names: namesRaw, followup } = extractMediaMarkers(reply);
    const names = filterUnsentMedia(clientId, connId, phone, namesRaw);
    if (names.length < namesRaw.length) {
      console.log(`[Evolution sendReply] Mídia(s) já enviada(s) nesta conversa, ignorando repetição: ${JSON.stringify(namesRaw.filter((n) => !names.includes(n)))}`);
    }
    const textToSend = clean || reply;
    const chunks = agentCfg?.splitMessages
      ? splitMessage(textToSend, agentCfg.maxMessageLength ?? 300)
      : [textToSend];
    for (const chunk of chunks) markSent(phone, chunk);
    addMessage(phone, { role: "assistant", content: textToSend, ts: Date.now() }, clientId, { connId });
    const chunkDelayMs = Math.round((agentCfg?.splitMessageDelaySeconds ?? 1.5) * 1000);
    for (let i = 0; i < chunks.length; i++) {
      await evoSendText(instanceSnap, apiKeySnap, phone, chunks[i], isLidContact);
      if (i < chunks.length - 1) await new Promise<void>((r) => setTimeout(r, chunkDelayMs));
    }
    if (names.length > 0 && agentCfg?.mediaLibrary?.length) {
      await sendEvolutionMarkedMedia(instanceSnap, apiKeySnap, phone, names, agentCfg.mediaLibrary, isLidContact);
      markMediaSent(clientId, connId, phone, names);
    } else if (names.length > 0) {
      console.warn(`[Evolution sendReply] Media markers encontrados mas library vazia! names=${JSON.stringify(names)}`);
    }
    if (followup) {
      await new Promise<void>((r) => setTimeout(r, 800));
      markSent(phone, followup);
      await evoSendText(instanceSnap, apiKeySnap, phone, followup, isLidContact);
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
      if (new Date(batch.respondAfter) > new Date()) return;
      markProcessing(batch.id);
      const combined = batch.messages.join("\n");
      const h = getHistory(_phone, _clientId, connId);
      runGeminiAgent(combined, h, _clientId, _phone, connId)
        .then(async ({ text: geminiText, actions }) => {
          markDone(batch.id);
          if (getLeadByPhone(_clientId, _phone, funnelId)?.aiPaused) {
            console.log(`[Evolution IA batch] IA pausada durante processamento — descartando resposta para ${_phone}`);
            clearInterval(typingInterval);
            stopTyping(instanceSnap, apiKeySnap, _phone).catch(() => {});
            return;
          }
          if (geminiText) await sendReply(geminiText);
          if (actions.length && activeClient && agentCfg) {
            await processEvolutionActions(actions, instanceSnap, apiKeySnap, activeClient.name, agentCfg, _phone, isLidContact, _clientId, connId).catch(() => {});
          }
          const resumoActionBatch = actions.find((a) => a.type === "resumo_solicitado");
          if (resumoActionBatch && agentCfg?.googleRefreshToken && agentCfg.spreadsheetId && agentCfg.sheetMappings?.length) {
            const apiKey = getGeminiApiKey(agentCfg.geminiApiKey);
            if (apiKey) {
              const leadBatch = getLeadByPhone(_clientId, _phone);
              const realPhoneBatch = (leadBatch?.realPhone ?? _phone).replace(/\D/g, "");
              extractAndWriteToSheet({
                apiKey,
                spreadsheetId: agentCfg.spreadsheetId,
                googleRefreshToken: agentCfg.googleRefreshToken,
                sheetMappings: agentCfg.sheetMappings,
                messages: getHistory(_phone, _clientId, connId),
                phone: realPhoneBatch,
                motivo: resumoActionBatch.type === "resumo_solicitado" ? resumoActionBatch.motivo : undefined,
              }).catch((e) => console.warn("[Evolution] sheet-extractor erro:", e instanceof Error ? e.message : e));
            }
          }
        })
        .catch((e) => {
          console.error("[Evolution webhook] Erro no batch:", e);
          markDone(batch.id);
          clearInterval(typingInterval);
          stopTyping(instanceSnap, apiKeySnap, phone).catch(() => {});
        });
    }, waitSeconds * 1000);

    return NextResponse.json({ ok: true });
  }

  // ── Resposta imediata (sem batching) ──
  cancelPendingForPhone(clientId, phone);
  try {
    const { text: geminiText, actions } = await runGeminiAgent(text, history, clientId, phone, connId);
    if (getLeadByPhone(clientId, phone, funnelId)?.aiPaused) {
      console.log(`[Evolution IA] IA pausada durante processamento imediato — descartando resposta para ${phone}`);
      clearInterval(typingInterval);
      stopTyping(instanceSnap, apiKeySnap, phone).catch(() => {});
      return NextResponse.json({ ok: true });
    }
    if (geminiText) {
      await sendReply(geminiText);
    } else {
      clearInterval(typingInterval);
      stopTyping(instanceSnap, apiKeySnap, phone).catch(() => {});
    }
    if (actions.length && activeClient && agentCfg) {
      await processEvolutionActions(actions, instanceSnap, apiKeySnap, activeClient.name, agentCfg, phone, isLidContact, clientId, connId).catch(() => {});
    }
    const resumoActionImediato = actions.find((a) => a.type === "resumo_solicitado");
    if (resumoActionImediato && agentCfg?.googleRefreshToken && agentCfg.spreadsheetId && agentCfg.sheetMappings?.length) {
      const apiKey = getGeminiApiKey(agentCfg.geminiApiKey);
      if (apiKey) {
        const leadImediato = getLeadByPhone(clientId, phone);
        const realPhoneImediato = (leadImediato?.realPhone ?? phone).replace(/\D/g, "");
        extractAndWriteToSheet({
          apiKey,
          spreadsheetId: agentCfg.spreadsheetId,
          googleRefreshToken: agentCfg.googleRefreshToken,
          sheetMappings: agentCfg.sheetMappings,
          messages: getHistory(phone, clientId, connId),
          phone: realPhoneImediato,
          motivo: resumoActionImediato.type === "resumo_solicitado" ? resumoActionImediato.motivo : undefined,
        }).catch((e) => console.warn("[Evolution] sheet-extractor erro:", e instanceof Error ? e.message : e));
      }
    }
  } catch (e) {
    console.error("[Evolution webhook] Erro no Gemini:", e);
    clearInterval(typingInterval);
    stopTyping(instanceSnap, apiKeySnap, phone).catch(() => {});
  }

  return NextResponse.json({ ok: true });
}
