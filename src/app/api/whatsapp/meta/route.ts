import { NextRequest, NextResponse } from "next/server";
import { getFunnels } from "@/lib/funnels";
import { getClients } from "@/lib/clients";
import { upsertLeadByPhone, getLeadByPhone, markLeadNeedsAttention } from "@/lib/leads";
import { addMessage, getHistory } from "@/lib/conversations";
import { runGeminiAgent } from "@/lib/gemini-agent";
import { getClientById, getAgentConfigForConnection } from "@/lib/clients";
import { upsertPending, getPendingForPhone, markProcessing, markDone } from "@/lib/pending-responses";
import { startFollowUpSequence, cancelFollowUpsForPhone, getFollowUpByWamid, markFailed } from "@/lib/followups";
import { sendMessageDirect, getGeminiApiKey } from "@/lib/whatsapp-send";
import { splitMessage } from "@/lib/uazapi";
import { sendTemplate } from "@/lib/waba-templates";
import { generateSummaryText } from "@/lib/summary-generator";
import { extractAndWriteToSheet } from "@/lib/sheet-extractor";
import type { GeminiAction } from "@/lib/gemini-agent";

// GET — verificação do webhook Meta
export async function GET(req: NextRequest) {
  const mode  = req.nextUrl.searchParams.get("hub.mode");
  const token = req.nextUrl.searchParams.get("hub.verify_token");
  const challenge = req.nextUrl.searchParams.get("hub.challenge");

  if (mode === "subscribe") {
    // Aceita qualquer verify_token — cada funil pode ter o seu
    const funnels = getFunnels();
    const matched = funnels.some(f =>
      f.connections?.some(c => c.type === "meta" && c.metaVerifyToken === token)
    );
    if (matched && challenge) return new NextResponse(challenge, { status: 200 });
    // Fallback: aceita "trafegopago" como token padrão
    if (token === "trafegopago" && challenge) return new NextResponse(challenge, { status: 200 });
  }
  return NextResponse.json({ error: "Forbidden" }, { status: 403 });
}

// POST — recebe mensagens da Meta
export async function POST(req: NextRequest) {
  const body = await req.json();

  const entries = body.entry ?? [];
  for (const entry of entries) {
    for (const change of (entry.changes ?? [])) {
      if (change.field !== "messages") continue;
      const value = change.value;
      const phoneNumberId = value?.metadata?.phone_number_id;

      // Encontra funil pela phoneNumberId
      const funnels = getFunnels();
      let funnelId: string | null = null;
      let clientId: string | null = null;
      let metaToken: string | null = null;
      let connId: string | null = null;
      let entradaColumnId = "entrada";

      for (const f of funnels) {
        const conn = f.connections?.find(c => c.type === "meta" && c.metaPhoneNumberId === phoneNumberId);
        if (!conn) continue;
        funnelId = f.id;
        metaToken = conn.metaToken ?? null;
        connId = conn.id;
        entradaColumnId = f.columns?.[0]?.id ?? "entrada";
        // Prioriza agentConfig (fonte autoritativa do cliente) sobre funnel.clientId
        const allClients = getClients();
        const clientByAgent = allClients.find(c =>
          c.agentConfig?.whatsappConnectionId === conn.id ||
          c.agentConfigs?.some(a => a.whatsappConnectionId === conn.id)
        );
        clientId = clientByAgent?.id ?? f.clientId ?? null;
        break;
      }

      // ── Status assíncrono de entrega (sent/delivered/read/failed) ────────
      // A Graph API pode aceitar o envio do template (HTTP 200 + wamid) e só
      // reportar a falha de entrega real aqui, depois, via webhook — sem isso
      // o follow-up ficava marcado como "sent" mesmo nunca chegando ao lead.
      for (const status of (value?.statuses ?? [])) {
        if (status.status !== "failed") continue;
        const wamid = status.id;
        const errInfo = status.errors?.[0];
        const errMsg = errInfo ? `${errInfo.code ?? ""} ${errInfo.title ?? errInfo.message ?? ""}`.trim() : "falha de entrega reportada pela Meta";
        const followUp = wamid ? getFollowUpByWamid(wamid) : undefined;
        if (followUp) {
          markFailed(followUp.id, errMsg);
          console.error(`[meta] status FAILED wamid=${wamid} followUpId=${followUp.id} erro="${errMsg}"`);
        } else {
          console.error(`[meta] status FAILED wamid=${wamid} (sem follow-up correspondente) erro="${errMsg}"`);
        }
      }

      for (const msg of (value?.messages ?? [])) {
        const phone = msg.from?.replace(/\D/g, "");
        const text = msg.text?.body || msg.button?.text || "";
        if (!phone || !text.trim()) continue;

        const pushName = value?.contacts?.find((c: { wa_id: string }) => c.wa_id === msg.from)?.profile?.name ?? phone;
        const cid = clientId ?? "sem-cliente";
        const ts = Date.now();

        // ── Lead / CRM ────────────────────────────────────────────────────
        const effectiveFunnelId = funnelId ?? "default";
        const existingLead = getLeadByPhone(cid, phone, effectiveFunnelId);
        const isNew = !existingLead;

        upsertLeadByPhone(cid, phone, {
          clientId: cid,
          funnelId: effectiveFunnelId,
          source: "whatsapp",
          ...(isNew || existingLead?.name === phone ? { name: pushName } : {}),
          ...(isNew ? { status: entradaColumnId } : {}),
        });

        // ── Histórico ────────────────────────────────────────────────────
        addMessage(phone, { role: "user", content: text, ts }, clientId, { connId: connId ?? undefined, contactName: pushName !== phone ? pushName : undefined });

        // ── Verifica se IA está pausada ──────────────────────────────────
        const currentLead = getLeadByPhone(cid, phone, effectiveFunnelId);
        if (currentLead?.aiPaused) {
          console.log(`[meta] IA pausada para phone=${phone} cid=${cid} — ignorando`);
          continue;
        }

        // ── Agente config ────────────────────────────────────────────────
        const client = cid !== "sem-cliente" ? getClientById(cid) : null;
        const agentCfg = client && connId ? getAgentConfigForConnection(client, connId) : undefined;
        const geminiEnabled = agentCfg?.enabled === true;
        const waitSeconds = agentCfg?.messageWaitSeconds ?? 0;

        if (!geminiEnabled) {
          console.log(`[meta] Agente desabilitado para cid=${cid} connId=${connId}`);
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
            console.log(`[meta] MODO TESTE — ignorando phone=${phone} (permitido: ${testNorm})`);
            continue;
          }
          console.log(`[meta] testPhone match — phone=${phone} ✓`);
        }

        // ── Mídia no primeiro contato ────────────────────────────────────
        if (isNew && cid !== "sem-cliente" && metaToken && phoneNumberId) {
          const mediaItems = agentCfg?.mediaLibrary?.filter((m) => m.sendOnFirstContact) ?? [];
          for (const media of mediaItems) {
            // Para Meta API só texto por ora (imagens requerem media upload separado)
            if (media.type === "image" && media.url) {
              await fetch(`https://graph.facebook.com/v19.0/${phoneNumberId}/messages`, {
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
            startFollowUpSequence(cid, phone, agentCfg.followUps, connId ?? undefined);
          } else {
            cancelFollowUpsForPhone(cid, phone);
            startFollowUpSequence(cid, phone, agentCfg.followUps, connId ?? undefined);
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
              addMessage(phone, { role: "assistant", content: chunks[i], ts: Date.now() }, clientId, { connId: connId ?? undefined });
            } else {
              console.error(`[meta] sendMetaReply FALHOU — mensagem NÃO entregue ao WhatsApp. phone=${phone} phoneNumberId=${phoneNumberId}`);
            }
            if (i < chunks.length - 1) await new Promise<void>((r) => setTimeout(r, chunkDelayMs));
          }
        }

        // ── processMetaActions: aviso + sheet extractor ─────────────────
        async function processMetaActions(actions: GeminiAction[]) {
          console.log(`[meta-aviso] DIAG actions=${actions.length} agentCfg=${!!agentCfg} metaToken=${!!metaToken} phoneNumberId=${!!phoneNumberId}`);
          if (!actions.length || !agentCfg || !metaToken || !phoneNumberId) {
            console.log(`[meta-aviso] ABORTADO — falta: actions=${actions.length} agentCfg=${!!agentCfg} metaToken=${!!metaToken} phoneId=${!!phoneNumberId}`);
            return;
          }
          const resumoAction = actions.find((a) => a.type === "resumo_solicitado");
          console.log(`[meta-aviso] resumo_solicitado=${!!resumoAction} motivo="${resumoAction?.motivo ?? "-"}"`);
          if (!resumoAction) return;

          // Marca o lead como precisando de atenção humana (painel de urgência no portal do cliente)
          markLeadNeedsAttention(cid, phone, effectiveFunnelId, resumoAction.motivo);

          // Sheet extractor
          if (agentCfg.googleRefreshToken && agentCfg.spreadsheetId && agentCfg.sheetMappings?.length) {
            const hist = getHistory(phone, clientId, connId ?? undefined);
            extractAndWriteToSheet({
              apiKey: agentCfg.geminiApiKey || getGeminiApiKey() || "",
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
          console.log(`[meta-aviso] destinatários=${recipients.length} templateName="${agentCfg.metaSummaryTemplateName ?? "NÃO CONFIGURADO"}"`);
          if (!recipients.length) {
            console.log(`[meta-aviso] ABORTADO — nenhum destinatário em avisos[]`);
            return;
          }

          const clientName = client?.name ?? cid;
          const geminiKey = agentCfg.geminiApiKey || getGeminiApiKey() || "";
          const summaryText = await generateSummaryText(clientName, agentCfg, phone, resumoAction.motivo, geminiKey);

          // Variáveis do template:
          // {{1}} = número do lead, {{2}} = nome do lead, {{3}} = motivo + resumo
          const var1 = phone.replace(/\D/g, "");
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
            recipients
              .filter((r) => {
                if (r.type !== "phone") {
                  console.warn(`[meta-aviso] grupo ignorado (WABA não suporta grupos): ${r.value}`);
                  return false;
                }
                return true;
              })
              .map(async (r) => {
                if (templateName) {
                  console.log(`[meta-aviso] sendTemplate → phone=${r.value} template=${templateName} phoneNumberId=${phoneNumberId}`);
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
                    console.log(`[meta-aviso] sendTemplate OK → ${r.value}`);
                    // Registra na conversa do gestor (r.value), não do lead
                    addMessage(r.value, { role: "assistant", content: avisoMsg, ts: Date.now() }, clientId, { connId: connId ?? undefined });
                  }
                } else {
                  // Fallback texto livre (funciona dentro da janela de 24h)
                  console.log(`[meta-aviso] fallback texto livre → ${r.value} (sem template configurado)`);
                  const fullMsg =
                    `📋 *Resumo — ${clientName}*\n\n` +
                    `📞 wa.me/${var1}\n📝 ${resumoAction.motivo}\n\n${summaryText}`;
                  await sendMessageDirect(r.value, fullMsg, phoneNumberId!, metaToken!);
                  addMessage(r.value, { role: "assistant", content: avisoMsg, ts: Date.now() }, clientId, { connId: connId ?? undefined });
                }
              })
          );
        }

        // ── Batching (messageWaitSeconds > 0) ────────────────────────────
        if (waitSeconds > 0) {
          const pending = upsertPending(cid, phone, text, waitSeconds);
          const pendingId = pending.id;

          setTimeout(() => {
            const batch = getPendingForPhone(cid, phone);
            if (!batch || batch.id !== pendingId || batch.status !== "pending") return;
            markProcessing(batch.id);
            const combined = batch.messages.join("\n");
            const h = getHistory(phone, clientId, connId ?? undefined);
            console.log(`[meta] Gemini batch phone=${phone} cid=${cid} msgs=${batch.messages.length}`);
            runGeminiAgent(combined, h, cid, phone, connId ?? undefined)
              .then(async ({ text: reply, actions }) => {
                markDone(batch.id);
                if (reply) await sendMetaReply(reply);
                await processMetaActions(actions);
              })
              .catch((e) => {
                console.error(`[meta] Gemini ERRO batch phone=${phone}:`, e);
                markDone(batch.id);
              });
          }, waitSeconds * 1000);

          continue;
        }

        // ── Resposta imediata ────────────────────────────────────────────
        console.log(`[meta] Gemini imediato phone=${phone} cid=${cid}`);
        const history = getHistory(phone, clientId, connId ?? undefined);
        const { text: reply, actions } = await runGeminiAgent(text, history, cid, phone, connId ?? undefined);
        if (reply) await sendMetaReply(reply);
        await processMetaActions(actions);
      }
    }
  }
  return NextResponse.json({ ok: true });
}

