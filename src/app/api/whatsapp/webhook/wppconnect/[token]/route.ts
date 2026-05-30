import { NextRequest, NextResponse } from "next/server";
import { getWppSessionById } from "@/lib/wppconnect-sessions";
import { getFunnels } from "@/lib/funnels";
import { getLeadByPhone, upsertLeadByPhone } from "@/lib/leads";
import { getConfig, getClientById, getAgentConfigForConnection } from "@/lib/clients";
import { getAdInfoById } from "@/lib/meta-api";
import { getHistory, addMessage } from "@/lib/conversations";
import { runGeminiAgent } from "@/lib/gemini-agent";
import { sendText as wppSendText } from "@/lib/wppconnect-api";
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

  console.log(`[WPPConnect Webhook] session=${wppSession.sessionName} event=${body.event} from=${body.from}`);

  // WPPConnect envia event = "onmessage" ou outros eventos
  const event = (body.event as string ?? "").toLowerCase();
  if (event !== "onmessage" && event !== "onanymessage" && event !== "message") {
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
  // IMPORTANTE: o campo `from` pode ser um LID interno do WhatsApp (ex: 18983856173090)
  // e não o número real de telefone. Usa sender.number ou sender.id._serialized como prioridade.
  const sender = body.sender as Record<string, unknown> | undefined;
  const senderIdObj = sender?.id as Record<string, unknown> | undefined;

  const rawFrom =
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
  const isLidContact = String(body.from ?? "").endsWith("@lid");

  upsertLeadByPhone(clientId, phone, {
    clientId,
    funnelId,
    source: "whatsapp",
    ...(shouldUpdateName ? { name: pushName } : {}),
    ...(isNew ? { status: entradaColumnId } : {}),
    ...(isLidContact ? { isLid: true } : {}),
    ...adFields,
  });

  if (ctwaAdId) {
    console.log(`[WPPConnect Webhook] CTWa lead phone=${phone} adId=${ctwaAdId} adInfo=${JSON.stringify(adInfo)}`);
  }

  // ── Salva a mensagem na conversa (sempre) ──
  if (text.trim()) {
    const ts = Date.now();
    addMessage(
      phone,
      { role: fromMe ? "assistant" : "user", content: text, ts },
      clientId,
      { connId, contactName: !fromMe && pushName !== phone ? pushName : undefined },
    );
  }

  // Se foi enviado por nós, não responde via IA
  if (fromMe || !text.trim()) return NextResponse.json({ ok: true });

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
  const history = getHistory(phone);

  // Helper: envia e registra a resposta da IA
  const isLidPhone = String(body.from ?? "").endsWith("@lid");
  async function sendReply(reply: string) {
    addMessage(phone, { role: "assistant", content: reply, ts: Date.now() }, clientId, { connId });
    await wppSendText(wppSession!.sessionName, wppSession!.sessionToken, phone, reply, isLidPhone);
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
      const h = getHistory(_phone);
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
