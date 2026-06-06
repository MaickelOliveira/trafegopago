import { NextRequest, NextResponse } from "next/server";
import { readFileSync, existsSync, writeFileSync, mkdirSync } from "fs";
import path from "path";
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
import { sendText as wppSendText, sendMedia as wppSendMedia, sendMediaFromBase64, resolveContactPhone, getContactName } from "@/lib/wppconnect-api";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { getGeminiApiKey } from "@/lib/whatsapp-send";
import { transcribeMedia } from "@/lib/media-transcribe";
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
const ctwaLeadSet = new Set<string>(); // phones com CTWa confirmado (aguardando saudação fromMe)

// ── Extrai marcadores [MIDIA:nome] e [APOS_MIDIA:texto] do texto da IA ──
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
  }).replace(/[ \t]{2,}/g, " ").trim();
  return { clean, names, followup };
}

// ── Envia mídias marcadas via WPPConnect ──
async function sendWppMarkedMedia(
  sessionName: string,
  token: string,
  phone: string,
  names: string[],
  library: AgentMedia[],
  isLid: boolean,
): Promise<void> {
  const libraryNames = library.map((m) => m.name?.toLowerCase());
  for (const name of names) {
    const media = library.find((m) => m.name?.toLowerCase() === name);
    if (!media) {
      console.warn(`[WPPConnect sendWppMarkedMedia] Mídia "${name}" não encontrada. Library: ${JSON.stringify(libraryNames)}`);
      continue;
    }
    try {
      // Arquivo local: lê do disco e envia como base64
      const localMatch = media.url.match(/\/api\/uploads\/([^/?#]+)$/);
      if (localMatch) {
        const filePath = path.join(process.cwd(), "data", "uploads", localMatch[1]);
        if (!existsSync(filePath)) {
          console.warn(`[WPPConnect sendWppMarkedMedia] Arquivo não encontrado: ${filePath}`);
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
        const result = await sendMediaFromBase64(sessionName, token, phone, base64DataUri, mime, media.caption, isLid);
        console.log(`[WPPConnect sendWppMarkedMedia] "${name}" (base64 local) result=${result}`);
      } else {
        // URL externa: usa sendMedia padrão (com download)
        const result = await wppSendMedia(sessionName, token, phone, media.url, media.caption, isLid);
        console.log(`[WPPConnect sendWppMarkedMedia] "${name}" (url externa) result=${result}`);
      }
    } catch (e) {
      console.error(`[WPPConnect sendWppMarkedMedia] Erro ao enviar "${name}":`, e);
    }
    await new Promise<void>((r) => setTimeout(r, 700));
  }
}

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
  console.log(`[WPP-DIAG] token=${token} session=${wppSession?.id ?? "NOT_FOUND"} funnelId=${wppSession?.funnelId ?? "null"} clientId=${wppSession?.clientId ?? "null"}`);
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

  // Log completo para ajudar a diagnosticar history sync em caso de reincidência
  console.log(`[WPPConnect Webhook] session=${wppSession.sessionName} event=${body.event} from=${body.from} fromMe=${body.fromMe} chatId=${body.chatId} timestamp_raw=${(body.timestamp as number) ?? (body.t as number) ?? "n/a"}`);

  // ── Ignora mensagens históricas do sync de reconexão ──────────────────────
  // WPPConnect dispara "onmessage" para mensagens antigas ao reconectar.
  // O campo timestamp pode vir em SEGUNDOS ou MILISSEGUNDOS — normalizamos.
  let msgTimestamp = (body.timestamp as number) || (body.t as number) || 0;
  if (msgTimestamp > 1_000_000_000_000) {
    // timestamp em ms → converte para segundos
    msgTimestamp = Math.floor(msgTimestamp / 1000);
  }
  const nowSec = Math.floor(Date.now() / 1000);
  if (msgTimestamp > 0) {
    const ageSec = nowSec - msgTimestamp;
    // Bloqueia: (a) mensagens mais antigas que 5 min, ou (b) timestamp no futuro
    if (ageSec > 300 || ageSec < -30) {
      console.log(`[WPPConnect Webhook] histórico ignorado: phone_raw=${body.from} age=${ageSec}s ts=${msgTimestamp} (raw=${(body.timestamp as number) || (body.t as number)})`);
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
  // ── DIAGNÓSTICO: loga o body completo para leads novos (primeiro contato) ──
  // Isso permite ver exatamente o que o WPPConnect envia e onde está o referral.
  const isNewPhone = !getLeadByPhone(
    (getFunnels().find(f => f.id === wppSession.funnelId)?.clientId ?? wppSession.clientId ?? "sem-cliente"),
    phone,
  );
  if (isNewPhone && !fromMe) {
    // Trunca campos grandes (base64) para não poluir o log
    const bodyForLog = Object.fromEntries(
      Object.entries(body).map(([k, v]) => {
        if (typeof v === "string" && v.length > 200) return [k, `<truncated:${v.length}chars>`];
        return [k, v];
      }),
    );
    console.log(`[WPPConnect CTWa DIAG] NOVO LEAD phone=${phone} BODY_KEYS=${JSON.stringify(Object.keys(body))}`);
    console.log(`[WPPConnect CTWa DIAG] BODY=${JSON.stringify(bodyForLog)}`);

    // Salva em arquivo para acesso via /api/debug/webhook-payloads
    try {
      const debugFile = path.join(process.cwd(), "data", "debug-webhook-payloads.json");
      mkdirSync(path.dirname(debugFile), { recursive: true });
      const existing: unknown[] = existsSync(debugFile)
        ? (JSON.parse(readFileSync(debugFile, "utf-8")) as unknown[])
        : [];
      existing.unshift({ ts: new Date().toISOString(), phone, session: wppSession.sessionName, body: bodyForLog });
      if (existing.length > 20) existing.length = 20; // guarda só os últimos 20
      writeFileSync(debugFile, JSON.stringify(existing, null, 2));
    } catch (e) {
      console.warn("[WPPConnect CTWa DIAG] Erro ao salvar debug file:", e);
    }
  }

  // WPPConnect pode enviar o referral CTWa em campos diferentes dependendo da versão:
  //  - body.referral  (padrão documentado)
  //  - body.ctwaContext (versões mais novas do whatsapp-web.js)
  //  - body._data?.referral (acesso interno)
  const referral =
    (body.referral as Record<string, unknown> | undefined) ||
    (body.ctwaContext as Record<string, unknown> | undefined);
  const bodyData = body._data as Record<string, unknown> | undefined;
  const referralFromData = bodyData?.referral as Record<string, unknown> | undefined;
  const effectiveReferral = referral || referralFromData;

  // Normaliza: || undefined converte string vazia para undefined
  let ctwaAdId      = (((effectiveReferral?.source_id ?? effectiveReferral?.sourceId) as string | undefined) || undefined);
  const ctwaSourceUrl = (((effectiveReferral?.source_url ?? effectiveReferral?.sourceUrl) as string | undefined) || undefined);
  const ctwaHeadline  = ((effectiveReferral?.headline as string | undefined) || undefined);
  const ctwaSourceType = (((effectiveReferral?.source_type ?? effectiveReferral?.sourceType) as string | undefined) || undefined);
  const ctwaConversionSource = ((effectiveReferral?.conversionSource as string | undefined) || undefined);

  // Se source_id não veio, tenta extrair o Ad ID da source_url
  // Formatos conhecidos:
  //   https://www.facebook.com/ads/adId=<ID>
  //   https://fb.me/ads/<ID>
  //   https://www.facebook.com/...?adId=<ID>&...
  if (!ctwaAdId && ctwaSourceUrl) {
    const urlAdIdMatch =
      ctwaSourceUrl.match(/[?&]adId=(\d+)/i) ||
      ctwaSourceUrl.match(/\/ads\/adId=(\d+)/i) ||
      ctwaSourceUrl.match(/fb\.me\/ads\/(\d+)/i) ||
      ctwaSourceUrl.match(/\/ads\/(\d{10,})/i);
    if (urlAdIdMatch) {
      ctwaAdId = urlAdIdMatch[1];
      console.log(`[WPPConnect CTWa] Ad ID extraído da source_url: ${ctwaAdId}`);
    }
  }

  // Se ainda sem ad ID e a URL é um link curto fb.me, tenta seguir o redirect
  // para obter a URL final que pode conter o ad ID
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
          console.log(`[WPPConnect CTWa] Ad ID extraído da URL resolvida (${resolvedUrl}): ${ctwaAdId}`);
        } else {
          console.log(`[WPPConnect CTWa] URL resolvida sem ad ID: ${resolvedUrl}`);
        }
      }
    } catch (e) {
      console.warn("[WPPConnect CTWa] Erro ao resolver fb.me redirect:", e instanceof Error ? e.message : e);
    }
  }

  if (effectiveReferral) {
    console.log(`[WPPConnect CTWa] referral detectado — conversionSource=${ctwaConversionSource} source_id=${ctwaAdId} source_type=${ctwaSourceType} headline="${ctwaHeadline}" source_url=${ctwaSourceUrl}`);
  }

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
  // Roda sempre que houver CTWa referral com Ad ID (novo ou retornante — lead pode ter
  // clicado em anúncio diferente numa nova sessão).
  let adInfo: Awaited<ReturnType<typeof getAdInfoById>> = null;
  const shouldLookupAd = !!ctwaAdId && (!existingLead?.adId || existingLead.adId !== ctwaAdId);
  if (shouldLookupAd) {
    try {
      const cfg = getConfig();
      if (cfg.metaToken) {
        adInfo = await getAdInfoById(ctwaAdId!, cfg.metaToken);
        console.log(`[WPPConnect CTWa] Meta API result: campaign="${adInfo?.campaignName}" adSet="${adInfo?.adSetName}" ad="${adInfo?.adName}"`);
      } else {
        console.warn("[WPPConnect CTWa] metaToken não configurado — não foi possível resolver campanha via Meta API");
      }
    } catch (e) {
      console.warn("[WPPConnect CTWa] Erro ao chamar Meta API:", e instanceof Error ? e.message : e);
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

  // Detecta se o contato usa LID (novo sistema interno do WhatsApp)
  const isLidContact =
    String(body.chatId ?? "").endsWith("@lid") ||
    String(body.from ?? "").endsWith("@lid");

  // ── Proteção contra criação de leads falsos no history sync do reconect ──
  // O filtro de timestamp acima (ageSec > 300) já bloqueia mensagens históricas com timestamp.
  // Aqui só bloqueamos o caso sem timestamp (campo ausente = nunca é mensagem real do WPPConnect).
  if (isNew && msgTimestamp === 0) {
    console.log(`[WPP-DIAG] BLOQUEADO: sem timestamp + lead novo phone=${phone}`);
    return NextResponse.json({ ok: true });
  }

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

  // Se a mensagem do cliente veio de um anúncio (CTWa), marca o telefone para que
  // o fromMe da saudação automática do WA Business não pause a IA (scenario B: cliente chega primeiro).
  if (ctwaAdId && !fromMe) {
    ctwaLeadSet.add(phone);
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
      // Verifica se é uma saudação automática do WA Business (ex: anúncios CTWa).
      // Dois cenários possíveis:
      //   A) fromMe chega ANTES da mensagem do cliente → histórico vazio → !hasUserMessages
      //   B) mensagem do cliente chega ANTES (race condition) → ctwaLeadSet marcado pelo adId
      const isCTWaGreeting = ctwaLeadSet.has(phone);
      const historyFM = getHistory(phone, clientId);
      const hasUserMessages = historyFM.some((m) => m.role === "user");
      if (!hasUserMessages || isCTWaGreeting) {
        if (isCTWaGreeting) ctwaLeadSet.delete(phone);
        console.log(`[WPPConnect fromMe] phone=${phone} — saudação automática (${isCTWaGreeting ? "CTWa identificado via adId" : "conversa nova"}), não pausa IA`);
        addMessage(phone, { role: "assistant", content: text, ts: Date.now() }, clientId, { connId });
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

  // ── Follow-ups: agenda quando lead responde, independente de IA ──────
  console.log(`[WPP-DIAG] chegou ao bloco follow-up: clientId=${clientId} connId=${connId} fromMe=${fromMe}`);
  if (clientId !== "sem-cliente") {
    const activeClientFU = getClientById(clientId);
    const agentCfgFU = activeClientFU ? getAgentConfigForConnection(activeClientFU, connId) : undefined;
    console.log(`[WPP-DIAG] agentCfgFU: found=${!!agentCfgFU} followUpEnabled=${agentCfgFU?.followUpEnabled} stepsCount=${agentCfgFU?.followUps?.length ?? 0} connMatch=${agentCfgFU?.whatsappConnectionId}`);
    if (agentCfgFU?.followUpEnabled && (agentCfgFU.followUps?.length ?? 0) > 0) {
      cancelFollowUpsForPhone(clientId, phone);
      startFollowUpSequence(clientId, phone, agentCfgFU.followUps);
      console.log(`[WPP-DIAG] ✅ follow-up AGENDADO phone=${phone} steps=${agentCfgFU.followUps.length}`);
    } else {
      console.log(`[WPP-DIAG] ❌ follow-up NÃO agendado — followUpEnabled=${agentCfgFU?.followUpEnabled} steps=${agentCfgFU?.followUps?.length ?? 0}`);
    }
  } else {
    console.log(`[WPP-DIAG] ❌ follow-up NÃO agendado — clientId=sem-cliente`);
  }

  // ── Verifica IA ──
  const currentLead = getLeadByPhone(clientId, phone);
  if (currentLead?.aiPaused) {
    console.log(`[WPPConnect IA] phone=${phone} clientId=${clientId} — IA pausada (aiPaused=true)`);
    return NextResponse.json({ ok: true });
  }

  const activeClient = clientId !== "sem-cliente" ? getClientById(clientId) : null;
  const agentCfg = activeClient ? getAgentConfigForConnection(activeClient, connId) : undefined;
  const geminiEnabled = agentCfg?.enabled === true;

  console.log(`[WPPConnect IA] phone=${phone} clientId=${clientId} connId=${connId} enabled=${geminiEnabled} hasAgentCfg=${!!agentCfg} activeClient=${activeClient?.name ?? "null"}`);

  if (!geminiEnabled || clientId === "sem-cliente") {
    console.log(`[WPPConnect IA] IA desligada — geminiEnabled=${geminiEnabled} clientId=${clientId}`);
    return NextResponse.json({ ok: true });
  }

  // testPhone: quando configurado, IA responde APENAS este número
  if (agentCfg?.testPhone) {
    const testNorm = agentCfg.testPhone.replace(/\D/g, "");
    // Comparação tolerante ao 9º dígito brasileiro e variações de prefixo:
    // extrai os últimos 8 dígitos (núcleo do número local) para comparação flexível
    const coreDigits = (n: string) => n.replace(/\D/g, "").slice(-8);
    const phoneMatches =
      phone === testNorm ||
      phone.endsWith(testNorm.slice(-9)) ||
      coreDigits(phone) === coreDigits(testNorm);
    if (!phoneMatches) {
      console.log(`[WPPConnect IA] phone=${phone} bloqueado — testPhone=${agentCfg.testPhone} core_phone=${coreDigits(phone)} core_test=${coreDigits(testNorm)} (modo teste ativo)`);
      return NextResponse.json({ ok: true });
    }
    console.log(`[WPPConnect IA] testPhone match — phone=${phone} testNorm=${testNorm} ✓`);
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

  console.log(`[WPPConnect IA] Chamando runGeminiAgent — phone=${phone} clientId=${clientId} waitSeconds=${waitSeconds} historyLen=${history.length} text="${text.slice(0, 80)}"`);

  // Helper: envia e registra a resposta da IA
  const isLidPhone =
    String(body.chatId ?? "").endsWith("@lid") ||
    String(body.from ?? "").endsWith("@lid");
  async function sendReply(reply: string) {
    // Extrai marcadores [MIDIA:nome] e [FOLLOWUP:texto] do texto antes de enviar
    const { clean, names, followup } = extractMediaMarkers(reply);
    const textToSend = clean || reply;
    const chunks = agentCfg?.splitMessages
      ? splitMessage(textToSend, agentCfg.maxMessageLength ?? 300)
      : [textToSend];
    // Marca cada chunk antes de enviar (evita pausar IA no onselfmessage de volta)
    for (const chunk of chunks) markSent(phone, chunk);
    // Salva texto limpo (sem marcadores) no histórico
    addMessage(phone, { role: "assistant", content: textToSend, ts: Date.now() }, clientId, { connId });
    // Envia cada chunk separadamente
    for (const chunk of chunks) {
      await wppSendText(wppSession!.sessionName, wppSession!.sessionToken, phone, chunk, isLidPhone);
    }
    // Envia mídias referenciadas (se houver)
    if (names.length > 0 && agentCfg?.mediaLibrary?.length) {
      await sendWppMarkedMedia(wppSession!.sessionName, wppSession!.sessionToken, phone, names, agentCfg.mediaLibrary, isLidPhone);
    } else if (names.length > 0) {
      console.warn(`[WPPConnect sendReply] Media markers encontrados mas library vazia! names=${JSON.stringify(names)}`);
    }
    // Envia mensagem de follow-up após as mídias (se houver [APOS_MIDIA:texto])
    if (followup) {
      await new Promise<void>((r) => setTimeout(r, 800));
      markSent(phone, followup);
      await wppSendText(wppSession!.sessionName, wppSession!.sessionToken, phone, followup, isLidPhone);
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
      // Debounce verdadeiro: se outra mensagem estendeu o prazo, espera o próximo timer
      if (new Date(batch.respondAfter) > new Date()) return;
      markProcessing(batch.id);
      const combined = batch.messages.join("\n");
      const h = getHistory(_phone, _clientId);
      runGeminiAgent(combined, h, _clientId, _phone, connId)
        .then(async ({ text: geminiText, actions }) => {
          markDone(batch.id);
          console.log(`[WPPConnect IA batch] runGeminiAgent concluído — phone=${_phone} geminiTextLen=${geminiText?.length ?? 0} reply="${(geminiText ?? "").slice(0, 100)}"`);
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
    console.log(`[WPPConnect IA] runGeminiAgent concluído — phone=${phone} geminiTextLen=${geminiText?.length ?? 0} actions=${actions.length} reply="${(geminiText ?? "").slice(0, 100)}"`);
    if (geminiText) await sendReply(geminiText);
    if (actions.length && activeClient && agentCfg) {
      await processWppActions(actions, wppSession!.sessionName, wppSession!.sessionToken, activeClient.name, agentCfg, phone, isLidPhone, clientId).catch(() => {});
    }
  } catch (e) {
    console.error("[WPPConnect webhook] Erro no Gemini:", e);
  }

  return NextResponse.json({ ok: true });
}
