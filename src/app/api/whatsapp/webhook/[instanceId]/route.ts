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
import { getFunnels } from "@/lib/funnels";
import { getClientById, getConfig } from "@/lib/clients";
import { getHistory, addMessage } from "@/lib/conversations";
import { upsertLeadByPhone, getLeadByPhone } from "@/lib/leads";
import { runGeminiAgent } from "@/lib/gemini-agent";
import { sendText } from "@/lib/uazapi";
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
function extractMessage(body: Body): { phone: string; text: string; fromMe: boolean } | null {
  // ── Formato UazapiGO novo: { EventType:"messages", messages:[{phone,body,fromMe}], chat:{} } ──
  // É o formato real enviado por nexopro.uazapi.com
  const eventType = (body.EventType ?? body.eventType) as string | undefined;
  if (eventType === "messages" || eventType === "message") {
    const msgs = body.messages as Record<string, unknown>[] | undefined;
    if (Array.isArray(msgs) && msgs.length > 0) {
      const msg = msgs[0];
      const raw = String(msg.phone ?? msg.sender ?? msg.from ?? "");
      const phone = raw.replace("@s.whatsapp.net", "").replace(/\D/g, "");
      const text = String(msg.body ?? msg.message ?? msg.text ?? msg.content ?? "");
      const fromMe = msg.fromMe === true || msg.from_me === true;
      if (phone) return { phone, text, fromMe };
    }
    // Fallback: chat.phone + body de um campo genérico
    const chat = body.chat as Record<string, unknown> | undefined;
    const chatPhone = String(chat?.phone ?? "").replace(/\D/g, "");
    if (chatPhone) {
      const text = String(body.body ?? body.message ?? body.text ?? "");
      return { phone: chatPhone, text, fromMe: false };
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

  console.log(`[webhook/${instanceId}] body=`, JSON.stringify(body).slice(0, 1200));

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
    if (!extracted || isGroup(extracted.phone) || !isValidPhone(extracted.phone)) {
      return NextResponse.json({ ok: true });
    }

    const { phone, text, fromMe } = extracted;

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
    const contactName =
      (firstMsg?.pushName as string) ||
      (chatObj?.name as string) ||
      (body.chatName as string) ||
      (body.senderName as string) ||
      (body.pushName as string) ||
      phone;

    const cid = clientId ?? "sem-cliente";
    const funnelId = funnel?.id ?? "default";
    const existingLead = getLeadByPhone(cid, phone);
    const isNew = !existingLead;
    const shouldUpdateName = isNew || existingLead?.name === phone;

    // Coluna de entrada: primeira coluna do funil (normalmente "entrada" / "novo")
    const entradaColumn = funnel?.columns?.[0]?.id ?? "entrada";

    upsertLeadByPhone(cid, phone, {
      clientId: cid,
      funnelId,
      source: "whatsapp",
      ...(shouldUpdateName ? { name: contactName } : {}),
      ...(isNew ? { status: entradaColumn } : {}),
    });

    if (!text.trim()) return NextResponse.json({ ok: true });

    // ── Salva mensagem no histórico ───────────────────────────────────────
    const ts = Date.now();
    addMessage(phone, { role: fromMe ? "assistant" : "user", content: text, ts }, clientId);

    // Mensagem enviada por você → só salva, não responde
    if (fromMe) return NextResponse.json({ ok: true });

    // ── Follow-ups ───────────────────────────────────────────────────────
    if (cid !== "sem-cliente") {
      const agentCfg = getClientById(cid)?.agentConfig;
      if (agentCfg?.followUpEnabled && (agentCfg.followUps?.length ?? 0) > 0) {
        if (isNew) {
          startFollowUpSequence(cid, phone, agentCfg.followUps);
        } else {
          cancelFollowUpsForPhone(cid, phone);
          startFollowUpSequence(cid, phone, agentCfg.followUps);
        }
      }
    }

    const history = getHistory(phone);

    // Verifica se IA está pausada para esta conversa
    const currentLead = getLeadByPhone(cid, phone);
    if (currentLead?.aiPaused) return NextResponse.json({ ok: true });

    // Agente Kanban — atualiza CRM (fire-and-forget)
    if (cid !== "sem-cliente") {
      processKanbanActions(text, history, cid, phone).catch(() => {});
    }

    // ── Agente IA ─────────────────────────────────────────────────────────
    const activeClient = cid !== "sem-cliente" ? getClientById(cid) : null;
    const agentCfg = activeClient?.agentConfig;
    const geminiEnabled = agentCfg?.enabled === true;
    const waitSeconds = agentCfg?.messageWaitSeconds ?? 0;

    const matchSource = matchedFunnel ? "token-url" : fallbackByBodyToken ? "body-token" : fallbackByBodyName ? "body-name" : fallbackByUrlName ? "url-name" : "sem-funil";
    console.log(`[webhook/${instanceId}] phone=${phone} cid=${cid} funnel=${funnel?.id ?? "none"}(${matchSource}) gemini=${geminiEnabled} uazToken=${instanceUazToken.slice(0, 8)}...`);

    // Batching: acumula mensagens antes de responder
    if (geminiEnabled && waitSeconds > 0 && cid !== "sem-cliente") {
      const pending = upsertPending(cid, phone, text, waitSeconds);
      const _pendingId = pending.id;

      setTimeout(() => {
        const batch = getPendingForPhone(cid, phone);
        if (!batch || batch.id !== _pendingId || batch.status !== "pending") return;
        markProcessing(batch.id);
        const combined = batch.messages.join("\n");
        const h = getHistory(phone);
        runGeminiAgent(combined, h, cid, phone)
          .then(async ({ text: geminiText }) => {
            markDone(batch.id);
            if (geminiText) {
              addMessage(phone, { role: "assistant", content: geminiText, ts: Date.now() }, clientId);
              await sendText(instanceUazToken, phone, geminiText);
            }
          })
          .catch(() => markDone(batch.id));
      }, waitSeconds * 1000);

      return NextResponse.json({ ok: true });
    }

    // Resposta imediata
    if (!geminiEnabled || cid === "sem-cliente") return NextResponse.json({ ok: true });

    const { text: geminiText } = await runGeminiAgent(text, history, cid, phone);
    if (!geminiText) return NextResponse.json({ ok: true });

    addMessage(phone, { role: "assistant", content: geminiText, ts: Date.now() }, clientId);
    await sendText(instanceUazToken, phone, geminiText);

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(`[webhook/${instanceId}] Erro:`, err);
    return NextResponse.json({ ok: true }); // sempre 200 para evitar reenvios
  }
}

export async function GET() {
  return NextResponse.json({ status: "online", webhook: "per-instance" });
}
