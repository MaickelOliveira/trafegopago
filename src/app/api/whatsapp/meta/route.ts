import { verifyMetaSignature } from "@/lib/webhook-auth";
import { NextRequest, NextResponse } from "next/server";
import { getFunnels } from "@/lib/funnels";
import { getClients } from "@/lib/clients";
import { captureWhatsAppLead, hasLeadByPhone, getChatLeadByPhone as getLeadByPhone, markLeadNeedsAttention, toDialablePhone } from "@/lib/leads";
import { addMessage,getAiPaused, getHistory, updateMessage } from "@/lib/conversations";
import { runGeminiAgent } from "@/lib/gemini-agent";
import { getClientById, getAgentConfigForConnection, getConfig, isWithinBusinessHours } from "@/lib/clients";
import { isAgentPhoneIgnored } from "@/lib/agent-phone-policy";
import { upsertPending, getPendingForPhone, markProcessing, markDone } from "@/lib/pending-responses";
import { startFollowUpSequence, restartFollowUpSequence, getFollowUpByWamid, markFailed } from "@/lib/followups";
import { sendMessageDirect, getGeminiApiKey, downloadMetaMedia } from "@/lib/whatsapp-send";
import { splitMessage } from "@/lib/message-text";
import { sendTemplate } from "@/lib/waba-templates";
import { generateSummaryText } from "@/lib/summary-generator";
import { extractAndWriteToSheet } from "@/lib/sheet-extractor";
import { processKanbanActions } from "@/lib/kanban-agent";
import { chatMediaMessage } from "@/lib/chat-media-message";
import type { ChatMessage } from "@/lib/conversations";
import { transcribeMedia, type MediaKind } from "@/lib/media-transcribe";
import { getAdInfoById } from "@/lib/meta-api";
import type { GeminiAction } from "@/lib/gemini-agent";

// GET — verificação do webhook Meta
export async function GET(req: NextRequest) {
  const mode  = req.nextUrl.searchParams.get("hub.mode");
  const token = req.nextUrl.searchParams.get("hub.verify_token");
  const challenge = req.nextUrl.searchParams.get("hub.challenge");

  if (mode === "subscribe") {
    // Aceita qualquer verify_token — cada funil pode ter o seu
    const funnels = (await getFunnels());
    const matched = funnels.some(f =>
      f.connections?.some(c => c.type === "meta" && c.metaVerifyToken === token)
    );
    if (matched && challenge) return new NextResponse(challenge, { status: 200 });

  }
  return NextResponse.json({ error: "Forbidden" }, { status: 403 });
}

// POST — recebe mensagens da Meta
export async function POST(req: NextRequest) {
  const raw = await req.text();
  if (Buffer.byteLength(raw) > 2 * 1024 * 1024) return NextResponse.json({ error: "Payload muito grande." }, { status: 413 });
  const appSecret = (await getConfig()).metaAppSecret || process.env.META_APP_SECRET;
  if (!appSecret) return NextResponse.json({ error: "Configure a chave de verificação da Meta." }, { status: 503 });
  if (!verifyMetaSignature(raw, req.headers.get("x-hub-signature-256"), appSecret)) return NextResponse.json({ error: "Assinatura inválida." }, { status: 403 });
  let body;
  try { body = JSON.parse(raw); } catch { return NextResponse.json({ error: "JSON inválido." }, { status: 400 }); }


  const entries = body.entry ?? [];
  for (const entry of entries) {
    for (const change of (entry.changes ?? [])) {
      if (change.field !== "messages") continue;
      const value = change.value;
      const phoneNumberId = value?.metadata?.phone_number_id;

      // Encontra funil pela phoneNumberId
      const funnels = (await getFunnels());
      let funnelId: string | null = null;
      let clientId: string | null = null;
      let metaToken: string | null = null;
      let connId: string | null = null;
      let entradaColumnId = "entrada";

      const matches = funnels.flatMap(funnel => (funnel.connections ?? []).filter(connection => connection.type === "meta" && connection.metaPhoneNumberId === phoneNumberId).map(connection => ({ funnel, connection })));
      if (matches.length !== 1) continue;
      const mapped = matches[0];
      if (!mapped.funnel.clientId) continue;
      funnelId = mapped.funnel.id;
      clientId = mapped.funnel.clientId ?? null;
      connId = mapped.connection.id;
      metaToken = mapped.connection.metaToken ?? null;
      entradaColumnId = mapped.funnel.columns?.[0]?.id ?? "entrada";

      // ── Status assíncrono de entrega (sent/delivered/read/failed) ────────
      // A Graph API pode aceitar o envio do template (HTTP 200 + wamid) e só
      // reportar a falha de entrega real aqui, depois, via webhook — sem isso
      // o follow-up ficava marcado como "sent" mesmo nunca chegando ao lead.
      for (const status of (value?.statuses ?? [])) {
        if (status.status !== "failed") continue;
        const wamid = status.id;
        const errInfo = status.errors?.[0];
        const errMsg = errInfo ? `${errInfo.code ?? ""} ${errInfo.title ?? errInfo.message ?? ""}`.trim() : "falha de entrega reportada pela Meta";
        const followUp = wamid ? (await getFollowUpByWamid(wamid)) : undefined;
        if (followUp) {
          (await markFailed(followUp.id, errMsg));
          console.error(`[meta] status FAILED wamid=${wamid} followUpId=${followUp.id} erro="${errMsg}"`);
        } else {
          console.error(`[meta] status FAILED wamid=${wamid} (sem follow-up correspondente) erro="${errMsg}"`);
        }
      }

      for (const msg of (value?.messages ?? [])) {
        const phone = msg.from?.replace(/\D/g, "");
        if (!phone) continue;
        let text = msg.text?.body || msg.button?.text || "";

        const cid = clientId ?? "sem-cliente";
        const ts = Date.now();
        const messageId = typeof msg.id === "string" && msg.id.length <= 160 ? msg.id : undefined;
        let storedMedia: ChatMessage | undefined;
        let pendingTranscription: { buffer: Buffer; mime: string; kind: MediaKind; caption?: string } | undefined;
        const mediaTypeMap: Record<string, MediaKind> = { audio: "audio", image: "image", document: "document", video: "video" };
        const mediaKind = mediaTypeMap[msg.type as string];
        const mediaObj = mediaKind ? msg[msg.type as string] as { id?: string; mime_type?: string; caption?: string } | undefined : undefined;
        if (mediaKind) {
          text = mediaObj?.caption?.trim() || text || (mediaKind === "audio" ? "[Áudio]" : mediaKind === "image" ? "[Imagem]" : mediaKind === "video" ? "[Vídeo]" : "[Documento]");
          const buffer = mediaObj?.id && metaToken ? await downloadMetaMedia(mediaObj.id, metaToken).catch(() => null) : null;
          if (mediaKind === "audio" || mediaKind === "image") {
            storedMedia = await chatMediaMessage({ role: "user", content: text, ts, messageId, type: mediaKind, buffer: buffer ?? undefined, mimeType: mediaObj?.mime_type || (mediaKind === "audio" ? "audio/ogg" : "image/jpeg"), phone, clientId: cid, connId: connId ?? undefined });
          }
          if (buffer) pendingTranscription = { buffer, mime: mediaObj?.mime_type || (mediaKind === "audio" ? "audio/ogg" : "application/octet-stream"), kind: mediaKind, caption: mediaObj?.caption };

        }
        if (!text.trim()) continue;
        const pushName = value?.contacts?.find((c: { wa_id: string }) => c.wa_id === msg.from)?.profile?.name ?? phone;

        // ── Lead / CRM ────────────────────────────────────────────────────
        const effectiveFunnelId = funnelId ?? "default";
        const existingLead = (await getLeadByPhone(cid, phone, effectiveFunnelId));
        const isNew = !existingLead && !await hasLeadByPhone(cid,phone,effectiveFunnelId);

        // ── CTWa (Click-to-WhatsApp): a API oficial manda o referral do
        // anúncio direto em msg.referral, num formato documentado e estável —
        // sem precisar dos truques de regex/redirect que os outros canais
        // (WPPConnect/UazAPI) usam pra extrair isso de campos não-oficiais.
        const referral = msg.referral as Record<string, unknown> | undefined;
        // O campo do ad_id no referral oficial da Cloud API é `source_id`
        // (`ad_id` não existe nesse payload — por isso o lookup da campanha
        // nunca rodava e o sistema caía no headline como nome de campanha).
        const ctwaAdId = (referral?.source_id as string | undefined) || undefined;
        const ctwaHeadline = (referral?.headline as string | undefined) || undefined;
        const ctwaSourceUrl = (referral?.source_url as string | undefined) || undefined;

        // Para buscar dados da campanha na Graph API é necessário o token global
        // de Meta Ads (com permissão ads_read) — NÃO o token da conexão WhatsApp
        // (conn.metaToken), que só tem permissão de mensagens. Por isso a busca
        // usava o token errado, falhava silenciosamente e caía no headline como
        // nome de campanha. Mesmo padrão já usado no WPPConnect (cfg.metaToken).
        //
        // "alreadyFullyAttributed" = mesmo adId já salvo E já resolveu campaignId
        // via Graph API (não só o fallback de headline). Sem o "!!existingLead
        // ?.campaignId" aqui, um lead que caísse no fallback na primeira
        // mensagem (token ausente, rate limit, erro transitório) ficava preso
        // PARA SEMPRE com dados incompletos — nenhuma mensagem seguinte
        // tentava de novo. Quando já está totalmente atribuído, adFields fica
        // {} — senão uma mensagem de follow-up que ainda carrega o mesmo
        // referral sobrescreve Conjunto/Anúncio/Campaign ID (e até o
        // campaignName real da campanha) de volta pro headline.
        const metaAdsToken = (await getConfig()).metaToken;
        let adInfo: Awaited<ReturnType<typeof getAdInfoById>> = null;
        const alreadyFullyAttributed = !!ctwaAdId && existingLead?.adId === ctwaAdId && !!existingLead?.campaignId;
        const shouldLookupAd = !!ctwaAdId && !!metaAdsToken && !alreadyFullyAttributed;
        if (shouldLookupAd) {
          adInfo = await getAdInfoById(ctwaAdId!, metaAdsToken).catch(() => null);
          ;
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
          : alreadyFullyAttributed
          ? {}
          : ctwaAdId || ctwaHeadline || ctwaSourceUrl
          ? {
              adPlatform: "meta" as const,
              adId: ctwaAdId ?? null,
              campaignName: ctwaHeadline ?? null,
              adSourceUrl: ctwaSourceUrl ?? null,
            }
          : {};

        (await captureWhatsAppLead(cid, phone, {
          clientId: cid,
          funnelId: effectiveFunnelId,
          source: "whatsapp",
          ...(isNew || existingLead?.name === phone ? { name: pushName } : {}),
          ...(isNew ? { status: entradaColumnId } : {}),
          ...adFields,
        }));

        // ── Histórico ────────────────────────────────────────────────────
        const historyForKanbanMeta = (await getHistory(phone, clientId, connId ?? undefined));
        const added = await addMessage(phone, storedMedia ? { ...storedMedia, content: text } : { role: "user", content: text, ts, ...(messageId ? { messageId } : {}) }, clientId, { connId: connId ?? undefined, contactName: pushName !== phone ? pushName : undefined });
        if (!added) continue;
        // The attachment is already visible; transcription enriches the same message.
        if (pendingTranscription) {
          const clientForKey = await getClientById(cid);
          const agentCfgForKey = clientForKey && connId ? getAgentConfigForConnection(clientForKey, connId) : undefined;
          const apiKey = await getGeminiApiKey(agentCfgForKey?.geminiApiKey ?? undefined);
          if (apiKey) {
            try {
              const { buffer, mime, kind, caption } = pendingTranscription;
              const transcription = await transcribeMedia(buffer, mime, apiKey, kind);
              if (transcription) {
                text = caption ? `${caption}\n${transcription}` : transcription;
                await updateMessage(phone, { messageId, ts, role: "user" }, { content: text }, cid, connId!);
              }
            } catch { console.warn("[meta] Transcrição indisponível; mensagem e mídia preservadas."); }
          }
        }


        // ── Agente Kanban — roda sempre, independente da IA de atendimento ──
        if (cid !== "sem-cliente") {
          processKanbanActions(text, historyForKanbanMeta, cid, phone, connId ?? undefined).catch(() => {});
        }

        // ── Verifica se IA está pausada ──────────────────────────────────
        const currentLead = (await getLeadByPhone(cid, phone, effectiveFunnelId));
        if (currentLead?.aiPaused || await getAiPaused(phone,cid,connId)) {
          ;
          continue;
        }

        // ── Agente config ────────────────────────────────────────────────
        const client = cid !== "sem-cliente" ? (await getClientById(cid)) : null;
        const agentCfg = client && connId ? getAgentConfigForConnection(client, connId) : undefined;
        const geminiEnabled = agentCfg?.enabled === true
          && isWithinBusinessHours(agentCfg)
          && !isAgentPhoneIgnored(agentCfg, phone);
        const waitSeconds = agentCfg?.messageWaitSeconds ?? 0;

        if (!geminiEnabled) {
          ;
          continue;
        }

        // ── Modo teste: quando configurado, a IA responde APENAS este número ──
        if (agentCfg?.testPhone) {
          const testNorm = agentCfg.testPhone.replace(/\D/g, "");
          // Comparação tolerante ao 9º dígito brasileiro e variações de prefixo
          const coreDigits = (n: string) => n.replace(/\D/g, "").slice(-8);
          const phoneMatches =
            phone === testNorm ||
            phone.endsWith(testNorm.slice(-9)) ||
            coreDigits(phone) === coreDigits(testNorm);
          if (!phoneMatches) {
            ;
            continue;
          }
          ;
        }

        // ── Mídia no primeiro contato ────────────────────────────────────
        if (isNew && cid !== "sem-cliente" && metaToken && phoneNumberId) {
          const mediaItems = agentCfg?.mediaLibrary?.filter((m) => m.sendOnFirstContact) ?? [];
          for (const media of mediaItems) {
            // Para Meta API só texto por ora (imagens requerem media upload separado)
            if (media.type === "image" && media.url) {
              await fetch(`https://graph.facebook.com/v26.0/${phoneNumberId}/messages`, {
                method: "POST",
                headers: { "Authorization": `Bearer ${metaToken}`, "Content-Type": "application/json" },
                body: JSON.stringify({
                  messaging_product: "whatsapp",
                  to: phone,
                  type: "image",
                  image: { link: media.url, caption: media.caption ?? "" },
                }),
              }).catch(() => {});
            }
          }
        }

        // ── Follow-ups ───────────────────────────────────────────────────
        if (cid !== "sem-cliente" && agentCfg?.followUpEnabled && (agentCfg.followUps?.length ?? 0) > 0) {
          if (isNew) {
            (await startFollowUpSequence(cid, phone, agentCfg.followUps, connId ?? undefined));
          } else {
            (await restartFollowUpSequence(cid, phone, agentCfg.followUps, connId ?? undefined));
          }
        }

        // ── Helper: envia resposta via Meta API ──────────────────────────
        async function sendMetaReply(replyText: string) {
          if (!replyText) return;
          if (!metaToken || !phoneNumberId) {
            console.error(`[meta] sendMetaReply ABORTADO — metaToken=${!!metaToken} phoneNumberId=${!!phoneNumberId} phone=${phone} cid=${cid}`);
            return;
          }
          const chunks = agentCfg?.splitMessages
            ? splitMessage(replyText, agentCfg.maxMessageLength ?? 300)
            : [replyText];
          const chunkDelayMs = Math.round((agentCfg?.splitMessageDelaySeconds ?? 1.5) * 1000);
          for (let i = 0; i < chunks.length; i++) {
            const ok = await sendMessageDirect(phone, chunks[i], phoneNumberId, metaToken);
            if (ok) {
              (await addMessage(phone, { role: "assistant", content: chunks[i], ts: Date.now() }, clientId, { connId: connId ?? undefined }));
            } else {
              console.error(`[meta] sendMetaReply FALHOU — mensagem NÃO entregue ao WhatsApp. phone=${phone} phoneNumberId=${phoneNumberId}`);
            }
            if (i < chunks.length - 1) await new Promise<void>((r) => setTimeout(r, chunkDelayMs));
          }
        }

        // ── processMetaActions: aviso + sheet extractor ─────────────────
        async function processMetaActions(actions: GeminiAction[]) {
          ;
          if (!actions.length || !agentCfg || !metaToken || !phoneNumberId) {
            ;
            return;
          }
          const resumoAction = actions.find((a) => a.type === "resumo_solicitado");
          ;
          if (!resumoAction) return;

          // Marca o lead como precisando de atenção humana (painel de urgência no portal do cliente)
          (await markLeadNeedsAttention(cid, phone, effectiveFunnelId, resumoAction.motivo));

          // Extrator interno (Pousada) e/ou planilha Google Sheets — grava
          // nos dois em paralelo enquanto o sistema da Pousada ainda está em
          // validação, pra não correr risco de perder dado.
          const clientForExtractor = (await getClientById(cid));
          if (agentCfg.googleRefreshToken && agentCfg.spreadsheetId && agentCfg.sheetMappings?.length) {
            const hist = (await getHistory(phone, clientId, connId ?? undefined));
            extractAndWriteToSheet({
              apiKey: agentCfg.geminiApiKey || (await getGeminiApiKey()) || "",
              spreadsheetId: agentCfg.spreadsheetId,
              googleRefreshToken: agentCfg.googleRefreshToken,
              sheetMappings: agentCfg.sheetMappings,
              messages: hist,
              phone,
              motivo: resumoAction.motivo,
            }).catch((e) => console.error("[meta] sheet-extractor ERRO:", e));
          }

          // Avisos
          const recipients = agentCfg.avisos?.length
            ? agentCfg.avisos
            : agentCfg.summaryPhone
              ? [{ id: "legacy", label: "Gestor", value: agentCfg.summaryPhone, type: "phone" as const }]
              : [];
          ;
          if (!recipients.length) {
            ;
            return;
          }

          const clientName = client?.name ?? cid;
          const geminiKey = agentCfg.geminiApiKey || (await getGeminiApiKey()) || "";
          const summaryText = await generateSummaryText(clientName, agentCfg, phone, resumoAction.motivo, geminiKey, clientId ?? undefined, connId ?? undefined);

          // Variáveis do template:
          // {{1}} = número do lead, {{2}} = nome do lead, {{3}} = motivo + resumo
          // A API oficial da Meta às vezes manda o wa_id sem o 9º dígito BR
          // (ex: 554498168355 em vez de 5544998168355), quebrando o link wa.me/.
          const var1 = toDialablePhone(phone);
          const var2 = pushName !== phone ? pushName : phone;
          // Meta não aceita \n, \t ou mais de 4 espaços consecutivos em parâmetros de template
          const cleanSummary = summaryText.replace(/[\n\r\t]/g, " ").replace(/ {5,}/g, "    ").trim();
          const var3 = `Motivo: ${resumoAction.motivo} | ${cleanSummary}`;
          const templateName = agentCfg.metaSummaryTemplateName;

          const avisoMsg =
            `📋 *Resumo de conversa enviado ao gestor*\n\n` +
            `📞 *Número:* wa.me/${var1}\n` +
            `👤 *Lead:* ${var2}\n` +
            `📝 *Motivo:* ${resumoAction.motivo}\n\n` +
            `${summaryText}`;

          await Promise.all(
            (await Promise.all(recipients
              .filter((r) => {
                if (r.type !== "phone") {
                  console.warn(`[meta-aviso] grupo ignorado (WABA não suporta grupos): ${r.value}`);
                  return false;
                }
                return true;
              })
              .map(async (r) => {
                if (templateName) {
                  ;
                  const result = await sendTemplate(
                    phoneNumberId!,
                    metaToken!,
                    r.value,
                    templateName,
                    "pt_BR",
                    [{ type: "body", parameters: [
                      { type: "text", text: var1 },
                      { type: "text", text: var2 },
                      { type: "text", text: var3 },
                    ]}],
                  );
                  if (!result.success) {
                    console.error(`[meta-aviso] sendTemplate FALHOU → ${r.value}:`, result.error);
                  } else {
                    ;
                    // Registra na conversa do gestor (r.value), não do lead
                    (await addMessage(r.value, { role: "assistant", content: avisoMsg, ts: Date.now() }, clientId, { connId: connId ?? undefined }));
                  }
                } else {
                  // Fallback texto livre (funciona dentro da janela de 24h)
                  ;
                  const fullMsg =
                    `📋 *Resumo — ${clientName}*\n\n` +
                    `📞 wa.me/${var1}\n📝 ${resumoAction.motivo}\n\n${summaryText}`;
                  await sendMessageDirect(r.value, fullMsg, phoneNumberId!, metaToken!);
                  (await addMessage(r.value, { role: "assistant", content: avisoMsg, ts: Date.now() }, clientId, { connId: connId ?? undefined }));
                }
              })))
          );
        }

        // ── Batching (messageWaitSeconds > 0) ────────────────────────────
        if (waitSeconds > 0) {
          const pending = (await upsertPending(cid, phone, text, waitSeconds, connId ?? undefined));
          const pendingId = pending.id;

          setTimeout(async () => {
            const batch = (await getPendingForPhone(cid, phone, connId ?? undefined));
            if (!batch || batch.id !== pendingId || batch.status !== "pending") return;
            if (!await markProcessing(batch.id)) return;
            const combined = batch.messages.join("\n");
            const h = (await getHistory(phone, clientId, connId ?? undefined));
            ;
            runGeminiAgent(combined, h, cid, phone, connId ?? undefined)
              .then(async ({ text: reply, actions }) => {
                (await markDone(batch.id));
                if (reply) await sendMetaReply(reply);
                await processMetaActions(actions);
              })
              .catch(async (e) => {
                console.error(`[meta] Gemini ERRO batch phone=${phone}:`, e);
                (await markDone(batch.id));
              });
          }, waitSeconds * 1000);

          continue;
        }

        // ── Resposta imediata ────────────────────────────────────────────
        ;
        const history = (await getHistory(phone, clientId, connId ?? undefined));
        const { text: reply, actions } = await runGeminiAgent(text, history, cid, phone, connId ?? undefined);
        if (reply) await sendMetaReply(reply);
        await processMetaActions(actions);
      }
    }
  }
  return NextResponse.json({ ok: true });
}
