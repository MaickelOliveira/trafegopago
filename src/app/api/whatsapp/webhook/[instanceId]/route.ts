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

// ── Extrai mensagem em diferentes formatos do UazapiGO ──────────────────────
function extractMessage(body: Body): { phone: string; text: string; fromMe: boolean } | null {
  // Formato UazapiGO padrão
  if (typeof body.phone === "string" && typeof body.message === "string") {
    return {
      phone: body.phone.replace(/\D/g, ""),
      text: body.message,
      fromMe: body.fromMe === true,
    };
  }

  // Formato Evolution API / alternativo
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

  console.log(`[webhook/${instanceId}]`, JSON.stringify(body).slice(0, 800));

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

    // ── Encontra funil + cliente pelo instanceId (nome da instância na URL) ──
    const funnels = getFunnels();

    const matchedFunnel = funnels.find((f) =>
      f.connections?.some((c) => c.id === instanceId && c.type === "uazapi")
    );

    // Fallback: tenta match pelo token da instância (campo uazapiToken)
    const bodyToken = (body.instanceToken ?? body.token) as string | undefined;
    const fallbackFunnel = !matchedFunnel && bodyToken
      ? funnels.find((f) =>
          f.connections?.some((c) => c.uazapiToken === bodyToken)
        )
      : undefined;

    const funnel = matchedFunnel ?? fallbackFunnel ?? null;
    const clientId = funnel?.clientId ?? null;

    // Pega o token da instância UazapiGO para enviar resposta
    const uazConn = funnel?.connections?.find(
      (c) => c.id === instanceId || (bodyToken && c.uazapiToken === bodyToken)
    );
    const instanceUazToken = uazConn?.uazapiToken ?? bodyToken ?? config.uazapiToken ?? "";

    // ── Upsert lead no CRM ────────────────────────────────────────────────
    const contactName =
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

    console.log(`[webhook/${instanceId}] phone=${phone} cid=${cid} gemini=${geminiEnabled} uazToken=${instanceUazToken.slice(0, 8)}...`);

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
