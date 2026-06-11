import { NextRequest, NextResponse } from "next/server";
import { getFunnels } from "@/lib/funnels";
import { getClients } from "@/lib/clients";
import { upsertLeadByPhone, getLeadByPhone } from "@/lib/leads";
import { addMessage, getHistory } from "@/lib/conversations";
import { runGeminiAgent } from "@/lib/gemini-agent";
import { getClientById, getAgentConfigForConnection } from "@/lib/clients";
import { upsertPending, getPendingForPhone, markProcessing, markDone } from "@/lib/pending-responses";
import { startFollowUpSequence, cancelFollowUpsForPhone } from "@/lib/followups";
import { sendMessageDirect } from "@/lib/whatsapp-send";
import { splitMessage } from "@/lib/uazapi";

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
            startFollowUpSequence(cid, phone, agentCfg.followUps);
          } else {
            cancelFollowUpsForPhone(cid, phone);
            startFollowUpSequence(cid, phone, agentCfg.followUps);
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
          for (const chunk of chunks) {
            const ok = await sendMessageDirect(phone, chunk, phoneNumberId, metaToken);
            if (ok) {
              addMessage(phone, { role: "assistant", content: chunk, ts: Date.now() }, clientId, { connId: connId ?? undefined });
            } else {
              console.error(`[meta] sendMetaReply FALHOU — mensagem NÃO entregue ao WhatsApp. phone=${phone} phoneNumberId=${phoneNumberId}`);
            }
          }
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
              .then(async ({ text: reply }) => {
                markDone(batch.id);
                if (reply) await sendMetaReply(reply);
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
        const { text: reply } = await runGeminiAgent(text, history, cid, phone, connId ?? undefined);
        if (reply) await sendMetaReply(reply);
      }
    }
  }
  return NextResponse.json({ ok: true });
}

