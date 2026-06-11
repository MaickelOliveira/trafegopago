import { NextRequest, NextResponse } from "next/server";
import { getConfig, getClientById, getAgentConfigForConnection } from "@/lib/clients";
import { getHistory, addMessage, sanitizeContactName } from "@/lib/conversations";
import { generateResponse } from "@/lib/ai-agent";
import { sendWhatsApp } from "@/lib/whatsapp";
import { sendMessage as sendMessageUnified } from "@/lib/whatsapp-send";
import { upsertLeadByPhone, getLeadByPhone } from "@/lib/leads";
import { getFunnels } from "@/lib/funnels";
import { processKanbanActions } from "@/lib/kanban-agent";
import { runGeminiAgent } from "@/lib/gemini-agent";
import { startFollowUpSequence, cancelFollowUpsForPhone } from "@/lib/followups";
import { upsertPending, getPendingForPhone, getDuePending, markDone, markProcessing, cancelPendingForPhone } from "@/lib/pending-responses";
import { sendCapiEvent } from "@/lib/meta-capi";
import { matchClick } from "@/lib/wa-clicks";

type Body = Record<string, unknown>;

/** Extrai payload de rastreamento oculto da mensagem.
 *  Formato embutido pelo snippet JS: " [_:src=google&cmp=campanha&fbc=xxx]"
 */
function parseWaTracking(text: string) {
  const match = text.match(/\[_:([^\]]+)\]/);
  if (!match) return null;
  const params = new URLSearchParams(match[1]);
  return {
    utmSource:   params.get("src") || null,
    utmCampaign: params.get("cmp") || null,
    utmMedium:   params.get("med") || null,
    utmContent:  params.get("cnt") || null,
    utmTerm:     params.get("trm") || null,
    fbclid:      params.get("fbc") || null,
    gclid:       params.get("gcd") || null,
  };
}

// Extrai phone + text de diferentes formatos de webhook (UazAPI / Evolution API)
function extractMessage(body: Body): { phone: string; text: string; fromMe: boolean } | null {
  // Formato UazAPI padrão legado (phone + message strings na raiz)
  if (typeof body.phone === "string" && typeof body.message === "string") {
    return {
      phone: body.phone.replace(/\D/g, ""),
      text: body.message,
      fromMe: body.fromMe === true,
    };
  }

  // Formato UazapiGO / nexopro: { EventType: "messages", chat: { phone }, message: { body/conversation, fromMe } }
  const eventType = (body.EventType ?? body.eventType) as string | undefined;
  const chat = body.chat as Record<string, unknown> | undefined;
  const msgObj = body.message as Record<string, unknown> | undefined;
  if ((eventType === "messages" || chat?.phone) && chat) {
    const rawPhone = (chat.phone ?? chat.wa_chatId ?? "") as string;
    const phone = rawPhone.replace("@s.whatsapp.net", "").replace(/\D/g, "");
    if (phone) {
      const text =
        (msgObj?.body as string) ||
        (msgObj?.conversation as string) ||
        ((msgObj?.extendedTextMessage as Record<string, string> | undefined)?.text ?? "") ||
        (msgObj?.caption as string) ||
        (typeof body.message === "string" ? body.message : "") ||
        "";
      const fromMe = msgObj?.fromMe === true || msgObj?.fromMe === "true";
      return { phone, text, fromMe };
    }
  }

  // Formato Evolution API / UazapiGO alternativo
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

function isValidPhone(phone: string): boolean {
  return phone.length >= 7 && phone.length <= 20;
}

export async function POST(req: NextRequest) {
  let body: Body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 });
  }

  console.log("[WhatsApp webhook FULL]", JSON.stringify(body).slice(0, 2000));

  // Repassa para n8n ou URL original (fire-and-forget)
  const config = getConfig();
  if (config.uazapiWebhookForward) {
    fetch(config.uazapiWebhookForward, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).catch((e) => console.error("[WhatsApp proxy]", e));
  }

  try {
    const extracted = extractMessage(body);

    // Ignora mensagens inválidas, grupos e WAIDs do Meta (IDs internos, não números reais)
    if (!extracted || isGroup(extracted.phone) || !isValidPhone(extracted.phone)) {
      return NextResponse.json({ ok: true });
    }

    const { phone, text: rawText, fromMe } = extracted;
    // Remove o código de rastreio [_:...] da mensagem — extração já foi feita, IA não deve ver
    const text = rawText.replace(/\s*\[_:[^\]]+\]/g, "").trim();

    // Identifica funil e cliente pelo instanceId ou instancePhone enviados pelo UazapiGO
    const chatObj = body.chat as Record<string, unknown> | undefined;
    const instancePhone = (
      (body.instancePhone as string | undefined) ||
      (chatObj?.owner as string | undefined)      // uazapiGO: "owner" = telefone da instância
    )?.replace(/\D/g, "");
    const uazInstanceId = (body.instanceId ?? body.instance ?? chatObj?.systemName) as string | undefined;
    const uazInstanceToken = (body.instanceToken ?? body.token) as string | undefined;

    let clientId: string | null = null;
    let funnelIdOverride: string | null = null;
    let incomingConnectionId: string | null = null;

    const funnels = getFunnels();

    // Busca por token UUID da instância (mais confiável)
    if (!clientId && uazInstanceToken) {
      for (const f of funnels) {
        const conn = f.connections?.find(c => c.type === "uazapi" && c.uazapiToken === uazInstanceToken);
        if (conn) {
          funnelIdOverride = f.id;
          clientId = f.clientId ?? null;
          incomingConnectionId = conn.id;
          break;
        }
      }
    }
    // Busca pelo nome da instância (instanceId no body) — aceita qualquer tipo
    if (!clientId && uazInstanceId) {
      for (const f of funnels) {
        const conn = f.connections?.find(c => c.id === uazInstanceId);
        if (conn) {
          funnelIdOverride = funnelIdOverride ?? f.id;
          clientId = f.clientId ?? null;
          incomingConnectionId = incomingConnectionId ?? conn.id;
          break;
        }
      }
    }
    // Busca pelo telefone da instância
    if (!clientId && instancePhone) {
      for (const f of funnels) {
        const conn = f.connections?.find(c => {
          const cp = (c.phone ?? "").replace(/\D/g, "");
          return cp.length > 0 && (cp === instancePhone || instancePhone.endsWith(cp.slice(-9)));
        });
        if (conn) {
          funnelIdOverride = funnelIdOverride ?? f.id;
          clientId = f.clientId ?? null;
          incomingConnectionId = incomingConnectionId ?? conn.id;
          break;
        }
      }
    }

    // Auto-captura lead no CRM — qualquer conversa (iniciada por você ou pelo lead)
    const rawContactName =
      (body.chatName as string) ||
      (body.senderName as string) ||
      (body.pushName as string) ||
      (chatObj?.wa_contactName as string) ||
      (chatObj?.name as string) ||
      phone;
    const contactName = sanitizeContactName(rawContactName, phone) ?? phone;

    const cid = clientId ?? "sem-cliente";
    const effectiveFunnelId = funnelIdOverride ?? "default";
    const existingLead = getLeadByPhone(cid, phone, effectiveFunnelId);
    const isNew = !existingLead;

    // Só atualiza o nome se for lead novo ou se o nome atual ainda é apenas o número
    const shouldUpdateName = isNew || (existingLead?.name === existingLead?.phone || existingLead?.name === phone);

    // Para leads novos: tenta associar a um clique recente via pixel/redirect (matchClick),
    // e cai back no payload inline da mensagem [_:...] se não houver match.
    let tracking: ReturnType<typeof parseWaTracking> = null;
    if (isNew) {
      const click = matchClick(cid, phone);
      if (click) {
        tracking = {
          utmSource:   click.utmSource,
          utmCampaign: click.utmCampaign,
          utmMedium:   click.utmMedium,
          utmContent:  click.utmContent,
          utmTerm:     click.utmTerm,
          fbclid:      click.fbclid,
          gclid:       click.gclid,
        };
      } else {
        tracking = parseWaTracking(rawText);
      }
    }

    const adPlatform = tracking
      ? ((): "meta" | "google" | null => {
          const s = (tracking.utmSource ?? "").toLowerCase();
          const metas = ["facebook", "instagram", "fb", "meta"];
          return tracking.fbclid || metas.includes(s) ? "meta"
            : tracking.gclid  || s === "google"       ? "google"
            : null;
        })()
      : undefined;

    const newLead = upsertLeadByPhone(cid, phone, {
      clientId: cid,
      funnelId: effectiveFunnelId,
      source: "whatsapp",
      ...(shouldUpdateName ? { name: contactName } : {}),
      ...(isNew ? { status: "entrada" } : {}),
      ...(tracking ? {
        adPlatform,
        utmSource:   tracking.utmSource,
        utmCampaign: tracking.utmCampaign,
        utmMedium:   tracking.utmMedium,
        utmContent:  tracking.utmContent,
        utmTerm:     tracking.utmTerm,
        fbclid:      tracking.fbclid,
        gclid:       tracking.gclid,
        campaignName: tracking.utmCampaign,
      } : {}),
    });

    // Envia Lead para Meta CAPI quando lead novo veio de anúncio Meta
    if (isNew && adPlatform === "meta") {
      const clientObj = getClientById(cid);
      if (clientObj?.pixelId) {
        sendCapiEvent({
          pixelId:   clientObj.pixelId,
          capiToken: clientObj.capiToken,
          eventName: "Lead",
          phone,
          externalId: newLead.id,
        }).catch((e) => console.error("[CAPI WA]", e));
      }
    }

    if (!text.trim()) return NextResponse.json({ ok: true });

    // Salva a mensagem na conversa com connId para isolar por conexão
    const ts = Date.now();
    const msgOpts = incomingConnectionId ? { connId: incomingConnectionId } : undefined;
    addMessage(phone, { role: fromMe ? "assistant" : "user", content: text, ts }, clientId, msgOpts);

    // Se foi você quem mandou pelo celular, só salva — não responde via IA
    if (fromMe) return NextResponse.json({ ok: true });

    // Quando lead responde: cancela follow-ups pendentes e inicia sequência se for novo lead
    if (cid !== "sem-cliente") {
      const activeClientCfg = getAgentConfigForConnection(getClientById(cid)!, incomingConnectionId);
      if (activeClientCfg?.followUpEnabled && (activeClientCfg.followUps?.length ?? 0) > 0) {
        if (isNew) {
          // Lead novo: inicia sequência de follow-ups
          startFollowUpSequence(cid, phone, activeClientCfg.followUps);
        } else {
          // Lead existente respondeu: cancela follow-ups pendentes (sequência reinicia)
          cancelFollowUpsForPhone(cid, phone);
          startFollowUpSequence(cid, phone, activeClientCfg.followUps);
        }
      }
    }

    // Histórico da conversa
    const history = getHistory(phone, cid);

    // Agente Kanban — roda sempre, independente da IA de atendimento (fire-and-forget)
    // NOTA: history já inclui a mensagem recém adicionada; removemos o último item
    // para não duplicar (runKanbanAgent envia lastMessage separadamente)
    if (cid !== "sem-cliente") {
      const historyForKanban = history.length > 1 ? history.slice(0, -1) : [];
      processKanbanActions(text, historyForKanban, cid, phone).catch((e) =>
        console.error("[kanban-agent]", e)
      );
    }

    // Verifica se IA está pausada para esta conversa específica
    const currentLead = getLeadByPhone(cid, phone);
    if (currentLead?.aiPaused) {
      return NextResponse.json({ ok: true });
    }

    const activeClient = cid !== "sem-cliente" ? getClientById(cid) : null;
    // Resolve o agentConfig correto: considera agentConfigs[] por conexão de entrada
    const agentCfg = activeClient
      ? getAgentConfigForConnection(activeClient, incomingConnectionId)
      : undefined;
    const geminiEnabled = agentCfg?.enabled === true;
    const waitSeconds = agentCfg?.messageWaitSeconds ?? 0;
    const connectionId = agentCfg?.whatsappConnectionId ?? incomingConnectionId;

    // testPhone: quando configurado, IA responde APENAS este número
    if (geminiEnabled && agentCfg?.testPhone) {
      const testNorm = agentCfg.testPhone.replace(/\D/g, "");
      if (phone !== testNorm && !phone.endsWith(testNorm.slice(-9))) {
        return NextResponse.json({ ok: true });
      }
    }

    console.log(`[webhook] phone=${phone} cid=${cid} connId=${incomingConnectionId ?? "none"} gemini=${geminiEnabled} wait=${waitSeconds}s sendConn=${connectionId ?? "none"}`);

    // ── Batching: acumula mensagens antes de responder ────────────────────────
    if (geminiEnabled && waitSeconds > 0 && cid !== "sem-cliente") {
      const pending = upsertPending(cid, phone, text, waitSeconds);
      const _cid = cid;
      const _phone = phone;
      const _clientId = clientId;
      const _connectionId = connectionId;
      const _incomingConnId = incomingConnectionId;
      const _pendingId = pending.id;

      // setTimeout in-process: responde após waitSeconds usando imports do topo do arquivo
      setTimeout(() => {
        const batch = getPendingForPhone(_cid, _phone);
        if (!batch || batch.id !== _pendingId || batch.status !== "pending") return;
        // Debounce verdadeiro: se outra mensagem estendeu o prazo, espera o próximo timer
        if (new Date(batch.respondAfter) > new Date()) return;
        markProcessing(batch.id);
        const combined = batch.messages.join("\n");
        const h = getHistory(_phone, _cid);
        console.log(`[webhook] Processando batch ${batch.id} (${batch.messages.length} msg) para ${_phone}`);
        runGeminiAgent(combined, h, _cid, _phone, _connectionId ?? undefined)
          .then(async ({ text: geminiText }) => {
            markDone(batch.id);
            console.log(`[webhook] Gemini respondeu (${geminiText?.length ?? 0} chars): ${geminiText?.slice(0, 80)}`);
            if (geminiText) {
              addMessage(_phone, { role: "assistant", content: geminiText, ts: Date.now() }, _clientId, _incomingConnId ? { connId: _incomingConnId } : undefined);
              await sendMessageUnified(_phone, geminiText, _cid, _connectionId ?? undefined);
              console.log(`[webhook] Mensagem enviada para ${_phone}`);
            }
          })
          .catch((e) => {
            console.error("[webhook] Erro ao processar batch:", e);
            markDone(batch.id);
          });
      }, waitSeconds * 1000);

      return NextResponse.json({ ok: true });
    }

    // ── Resposta imediata (sem batching) ─────────────────────────────────────
    // Cancela qualquer batch pendente (lead mandou mais mensagens fora do modo batch)
    if (cid !== "sem-cliente") cancelPendingForPhone(cid, phone);

    let reply: string | null = null;

    if (geminiEnabled && cid !== "sem-cliente") {
      const { text: geminiText } = await runGeminiAgent(text, history, cid, phone, connectionId ?? undefined);
      reply = geminiText || null;
    } else {
      reply = await generateResponse(text, history, clientId);
    }

    if (!reply) return NextResponse.json({ ok: true });

    addMessage(phone, { role: "assistant", content: reply, ts: Date.now() }, clientId, incomingConnectionId ? { connId: incomingConnectionId } : undefined);

    if (cid !== "sem-cliente") {
      await sendMessageUnified(phone, reply, cid, connectionId ?? undefined);
    } else {
      await sendWhatsApp(phone, reply);
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[WhatsApp webhook] Erro:", err);
    // Sempre retorna 200 para evitar reenvios do UazAPI
    return NextResponse.json({ ok: true });
  }
}

// Endpoint de verificação
export async function GET() {
  return NextResponse.json({
    status: "online",
    agent: "TráfegoPago WhatsApp AI",
    timestamp: new Date().toISOString(),
  });
}
