import { NextRequest, NextResponse } from "next/server";
import { getFunnels } from "@/lib/funnels";
import { upsertLeadByPhone, getLeadByPhone } from "@/lib/leads";
import { addMessage, getHistory } from "@/lib/conversations";
import { runGeminiAgent } from "@/lib/gemini-agent";
import { getClientById, getAgentConfigForConnection } from "@/lib/clients";
import { upsertPending, getPendingForPhone, markProcessing, markDone } from "@/lib/pending-responses";
import { startFollowUpSequence, cancelFollowUpsForPhone } from "@/lib/followups";
import { sendMessageDirect } from "@/lib/whatsapp-send";

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

      for (const f of funnels) {
        const conn = f.connections?.find(c => c.type === "meta" && c.metaPhoneNumberId === phoneNumberId);
        if (conn) { funnelId = f.id; clientId = f.clientId ?? null; metaToken = conn.metaToken ?? null; connId = conn.id; break; }
      }

      for (const msg of (value?.messages ?? [])) {
        const phone = msg.from?.replace(/\D/g, "");
        const text = msg.text?.body || msg.button?.text || "";
        if (!phone || !text.trim()) continue;

        const pushName = value?.contacts?.find((c: { wa_id: string }) => c.wa_id === msg.from)?.profile?.name ?? phone;
        const cid = clientId ?? "sem-cliente";
        const ts = Date.now();

        // ── Lead / CRM ────────────────────────────────────────────────────
        const existingLead = getLeadByPhone(cid, phone);
        const isNew = !existingLead;

        upsertLeadByPhone(cid, phone, {
          clientId: cid,
          funnelId: funnelId ?? "default",
          source: "whatsapp",
          ...(isNew || existingLead?.name === phone ? { name: pushName } : {}),
          ...(isNew ? { status: "entrada" } : {}),
        });

        // ── Histórico ────────────────────────────────────────────────────
        addMessage(phone, { role: "user", content: text, ts }, clientId);

        // ── Verifica se IA está pausada ──────────────────────────────────
        const currentLead = getLeadByPhone(cid, phone);
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
          if (!replyText || !metaToken || !phoneNumberId) return;
          addMessage(phone, { role: "assistant", content: replyText, ts: Date.now() }, clientId);
          await sendMessageDirect(phone, replyText, phoneNumberId, metaToken);
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
            const h = getHistory(phone);
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
        const history = getHistory(phone);
        const { text: reply } = await runGeminiAgent(text, history, cid, phone, connId ?? undefined);
        if (reply) await sendMetaReply(reply);
      }
    }
  }
  return NextResponse.json({ ok: true });
}

