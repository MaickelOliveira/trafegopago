import { NextRequest, NextResponse } from "next/server";
import { getClients, getConfig, getClientById } from "@/lib/clients";
import { getHistory, addMessage } from "@/lib/conversations";
import { generateResponse } from "@/lib/ai-agent";
import { sendWhatsApp } from "@/lib/whatsapp";
import { sendMessage as sendMessageUnified } from "@/lib/whatsapp-send";
import { upsertLeadByPhone, getLeadByPhone } from "@/lib/leads";
import { getFunnels } from "@/lib/funnels";
import { processKanbanActions } from "@/lib/kanban-agent";
import { runGeminiAgent } from "@/lib/gemini-agent";
import { startFollowUpSequence, cancelFollowUpsForPhone } from "@/lib/followups";
import { upsertPending, getPendingForPhone, getDuePending, markDone, markProcessing, cancelPendingForPhone } from "@/lib/pending-responses";

type Body = Record<string, unknown>;

// Extrai phone + text de diferentes formatos de webhook (UazAPI / Evolution API)
function extractMessage(body: Body): { phone: string; text: string; fromMe: boolean } | null {
  // Formato UazAPI padrão
  if (typeof body.phone === "string" && typeof body.message === "string") {
    return {
      phone: body.phone.replace(/\D/g, ""),
      text: body.message,
      fromMe: body.fromMe === true,
    };
  }

  // Formato Evolution API / Baileys
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

// WAIDs do Meta (IDs internos do Facebook) têm 14+ dígitos — não são números de telefone reais
function isValidPhone(phone: string): boolean {
  return phone.length >= 7 && phone.length <= 13;
}

export async function POST(req: NextRequest) {
  let body: Body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 });
  }

  console.log("[WhatsApp webhook]", JSON.stringify(body).slice(0, 300));

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

    const { phone, text, fromMe } = extracted;

    // Identifica funil e cliente pelo número da instância ou baileysClientId
    const instancePhone = (body.instancePhone as string | undefined)?.replace(/\D/g, "");
    const baileysClientId = body.baileysClientId as string | undefined;
    const baileysFunnelId = body.funnelId as string | undefined;

    let clientId: string | null = null;
    let funnelIdOverride: string | null = null;

    // Baileys: tenta encontrar funil pelo funnelId enviado diretamente
    const funnels = getFunnels();
    if (baileysFunnelId) {
      const matchedFunnel = funnels.find(f => f.id === baileysFunnelId);
      if (matchedFunnel) {
        funnelIdOverride = matchedFunnel.id;
        clientId = matchedFunnel.clientId ?? null;
      }
    }
    if (!clientId && baileysClientId) {
      // fallback: tenta encontrar funil pelo connectionId ou clientId
      const matchedFunnel = funnels.find(f =>
        f.id === baileysClientId ||
        f.connections?.some(c => c.id === baileysClientId)
      );
      if (matchedFunnel) {
        funnelIdOverride = funnelIdOverride ?? matchedFunnel.id;
        clientId = matchedFunnel.clientId ?? null;
      } else {
        clientId = baileysClientId;
      }
    }
    if (!clientId && instancePhone) {
      // Busca funil pelo whatsappPhone
      const matchedFunnel = funnels.find(f => {
        const fp = (f.whatsappPhone ?? "").replace(/\D/g, "");
        return fp.length > 0 && (fp === instancePhone || instancePhone.endsWith(fp.slice(-9)));
      });
      if (matchedFunnel) {
        funnelIdOverride = matchedFunnel.id;
        clientId = matchedFunnel.clientId ?? null;
      }
      // Fallback: busca por cliente
      if (!clientId) {
        const clients = getClients();
        const matched = clients.find((c) => {
          const cp = (c.whatsappPhone ?? "").replace(/\D/g, "");
          return cp.length > 0 && (cp === instancePhone || instancePhone.endsWith(cp.slice(-9)));
        });
        clientId = matched?.id ?? null;
      }
    } else if (!clientId) {
      // UazAPI: busca pelo número do contato (só se clientId ainda não foi encontrado)
      const clients = getClients();
      const matched = clients.find((c) => {
        const cp = (c.whatsappPhone ?? "").replace(/\D/g, "");
        return cp.length > 0 && phone.endsWith(cp.slice(-9));
      });
      clientId = matched?.id ?? null;
    }

    // Auto-captura lead no CRM — qualquer conversa (iniciada por você ou pelo lead)
    const contactName =
      (body.chatName as string) ||
      (body.senderName as string) ||
      (body.pushName as string) ||
      phone;

    const cid = clientId ?? "sem-cliente";
    const existingLead = getLeadByPhone(cid, phone);
    const isNew = !existingLead;

    // Só atualiza o nome se for lead novo ou se o nome atual ainda é apenas o número
    const shouldUpdateName = isNew || (existingLead?.name === existingLead?.phone || existingLead?.name === phone);

    upsertLeadByPhone(cid, phone, {
      clientId: cid,
      funnelId: funnelIdOverride ?? "default",
      source: "whatsapp",
      ...(shouldUpdateName ? { name: contactName } : {}),
      ...(isNew ? { status: "entrada" } : {}),
    });

    if (!text.trim()) return NextResponse.json({ ok: true });

    // Salva a mensagem na conversa (sempre — independente de IA ou fromMe)
    const ts = Date.now();
    addMessage(phone, { role: fromMe ? "assistant" : "user", content: text, ts }, clientId);

    // Se foi você quem mandou pelo celular, só salva — não responde via IA
    if (fromMe) return NextResponse.json({ ok: true });

    // Quando lead responde: cancela follow-ups pendentes e inicia sequência se for novo lead
    if (cid !== "sem-cliente") {
      const activeClientCfg = getClientById(cid)?.agentConfig;
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
    const history = getHistory(phone);

    // Verifica se IA está pausada para esta conversa específica
    const currentLead = getLeadByPhone(cid, phone);
    if (currentLead?.aiPaused) {
      return NextResponse.json({ ok: true });
    }

    // Agente Kanban — analisa conversa e atualiza CRM (fire-and-forget)
    if (cid !== "sem-cliente") {
      processKanbanActions(text, history, cid, phone).catch((e) =>
        console.error("[kanban-agent]", e)
      );
    }

    const activeClient = cid !== "sem-cliente" ? getClientById(cid) : null;
    const agentCfg = activeClient?.agentConfig;
    const geminiEnabled = agentCfg?.enabled === true;
    const waitSeconds = agentCfg?.messageWaitSeconds ?? 0;
    const connectionId = agentCfg?.whatsappConnectionId;

    console.log(`[webhook] phone=${phone} cid=${cid} gemini=${geminiEnabled} wait=${waitSeconds}s connId=${connectionId ?? "none"}`);

    // ── Batching: acumula mensagens antes de responder ────────────────────────
    if (geminiEnabled && waitSeconds > 0 && cid !== "sem-cliente") {
      const pending = upsertPending(cid, phone, text, waitSeconds);
      const _cid = cid;
      const _phone = phone;
      const _clientId = clientId;
      const _connectionId = connectionId;
      const _pendingId = pending.id;

      // setTimeout in-process: responde após waitSeconds usando imports do topo do arquivo
      setTimeout(() => {
        const batch = getPendingForPhone(_cid, _phone);
        if (!batch || batch.id !== _pendingId || batch.status !== "pending") return;
        markProcessing(batch.id);
        const combined = batch.messages.join("\n");
        const h = getHistory(_phone);
        console.log(`[webhook] Processando batch ${batch.id} (${batch.messages.length} msg) para ${_phone}`);
        runGeminiAgent(combined, h, _cid, _phone)
          .then(async ({ text: geminiText }) => {
            markDone(batch.id);
            console.log(`[webhook] Gemini respondeu (${geminiText?.length ?? 0} chars): ${geminiText?.slice(0, 80)}`);
            if (geminiText) {
              addMessage(_phone, { role: "assistant", content: geminiText, ts: Date.now() }, _clientId);
              await sendMessageUnified(_phone, geminiText, _cid, _connectionId);
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
      const { text: geminiText } = await runGeminiAgent(text, history, cid, phone);
      reply = geminiText || null;
    } else {
      reply = await generateResponse(text, history, clientId);
    }

    if (!reply) return NextResponse.json({ ok: true });

    addMessage(phone, { role: "assistant", content: reply, ts: Date.now() }, clientId);

    if (cid !== "sem-cliente") {
      await sendMessageUnified(phone, reply, cid, connectionId);
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
