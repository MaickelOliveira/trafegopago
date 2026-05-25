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
import { sendText, sendMedia, splitMessage } from "@/lib/uazapi";
import type { AgentMedia, AgentConfig } from "@/lib/clients";
import type { GeminiAction } from "@/lib/gemini-agent";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { getGeminiApiKey } from "@/lib/whatsapp-send";

/**
 * Usa o Gemini para gerar um resumo em texto corrido da conversa.
 */
async function generateSummaryText(
  clientName: string,
  agCfg: AgentConfig,
  phone: string,
  motivo: string,
): Promise<string> {
  const history = getHistory(phone);
  if (history.length === 0) return "Sem histórico de conversa.";

  // Limita às últimas 20 mensagens e 3000 chars para evitar token limit
  const recent = history.slice(-20);
  let transcript = recent
    .map((m) => `${m.role === "user" ? "Lead" : "Agente"}: ${m.content}`)
    .join("\n");
  if (transcript.length > 3000) transcript = transcript.slice(-3000);

  const apiKey = getGeminiApiKey(agCfg.geminiApiKey ?? undefined);
  if (!apiKey) return "Chave Gemini não configurada — resumo indisponível.";
  const genAI = new GoogleGenerativeAI(apiKey);

  const prompt =
    `Você é um assistente que resume conversas de WhatsApp para o gestor.\n\n` +
    `Cliente/empresa: ${clientName}\n` +
    `Motivo do resumo: ${motivo}\n\n` +
    `Conversa:\n${transcript}\n\n` +
    `Faça um resumo objetivo em texto corrido (máximo 5 linhas) destacando: ` +
    `o que o lead quer, o estágio da conversa, dúvidas ou objeções levantadas, e próximo passo sugerido. ` +
    `Não use marcadores ou listas, escreva em parágrafos curtos.`;

  const modelsToTry = ["gemini-2.0-flash", "gemini-1.5-flash", "gemini-1.5-flash-latest"];
  for (const modelId of modelsToTry) {
    try {
      const model = genAI.getGenerativeModel({ model: modelId });
      const result = await model.generateContent(prompt);
      return result.response.text().trim();
    } catch (err) {
      console.warn(`[generateSummaryText] Falha com modelo ${modelId}:`, err);
    }
  }
  return "Não foi possível gerar o resumo automaticamente.";
}

/**
 * Envia resumo de conversa para o summaryPhone do cliente, com link wa.me para o lead.
 */
async function sendConversationSummary(
  token: string,
  clientName: string,
  agCfg: AgentConfig,
  phone: string,
  motivo: string,
): Promise<void> {
  const summaryPhone = agCfg.summaryPhone;
  if (!summaryPhone) return;

  const resumo = await generateSummaryText(clientName, agCfg, phone, motivo);
  const waLink = `https://wa.me/${phone.replace(/\D/g, "")}`;

  const msg =
    `📋 *Resumo de conversa — ${clientName}*\n\n` +
    `📞 *Lead:* ${waLink}\n` +
    `📝 *Motivo:* ${motivo}\n\n` +
    `${resumo}`;

  await sendText(token, summaryPhone, msg);
}

/**
 * Processa as actions retornadas pelo Gemini (exceto follow-ups, já tratados no agente).
 */
async function processGeminiActions(
  actions: GeminiAction[],
  token: string,
  clientName: string,
  agCfg: AgentConfig,
  phone: string,
): Promise<void> {
  for (const action of actions) {
    if (action.type === "resumo_solicitado") {
      await sendConversationSummary(token, clientName, agCfg, phone, action.motivo);
    }
  }
}

/**
 * Remove marcadores [MIDIA:nome] do texto e retorna os nomes encontrados + texto limpo.
 */
function extractMediaMarkers(text: string): { clean: string; names: string[] } {
  const pattern = /\[MIDIA:([^\]]+)\]/gi;
  const names: string[] = [];
  const clean = text.replace(pattern, (_, name: string) => {
    names.push(name.trim().toLowerCase());
    return "";
  }).replace(/\s{2,}/g, " ").trim();
  return { clean, names };
}

/**
 * Envia mídias referenciadas pelo agente após enviar o texto principal.
 */
async function sendMarkedMedia(
  token: string,
  phone: string,
  names: string[],
  library: AgentMedia[],
): Promise<void> {
  for (const name of names) {
    const media = library.find((m) => m.name?.toLowerCase() === name);
    if (!media) continue;
    await sendMedia(token, phone, media.type, media.url, media.caption, media.filename);
    await new Promise<void>((r) => setTimeout(r, 700));
  }
}
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
  // ── Formato UazapiGO: { EventType:"messages", chat:{phone}, messages:[{body,fromMe}] } ──
  const eventType = (body.EventType ?? body.eventType) as string | undefined;
  const chat = body.chat as Record<string, unknown> | undefined;
  const msgObj = body.message as Record<string, unknown> | undefined;

  if (eventType === "messages" || eventType === "message" || chat?.phone) {
    // Tenta extrair do array messages[]
    const msgs = body.messages as Record<string, unknown>[] | undefined;
    if (Array.isArray(msgs) && msgs.length > 0) {
      const msg = msgs[0];
      const fromMe = msg.fromMe === true || msg.from_me === true;
      // Para mensagens fromMe, msg.phone é o remetente (número da empresa).
      // O número do CONTATO está em chat.phone — priorizamos ele quando fromMe=true.
      const rawPhone = fromMe
        ? String(chat?.phone ?? msg.phone ?? msg.sender ?? msg.from ?? "")
        : String(msg.phone ?? msg.sender ?? msg.from ?? chat?.phone ?? "");
      const phone = rawPhone.replace("@s.whatsapp.net", "").replace(/\D/g, "");

      const rawBody = msg.body ?? msg.message ?? msg.text ?? msg.content ?? msg.conversation ?? "";
      let text: string;
      if (typeof rawBody === "string") {
        text = rawBody;
      } else if (rawBody && typeof rawBody === "object") {
        const obj = rawBody as Record<string, unknown>;
        text = String(obj.text ?? obj.caption ?? obj.body ?? obj.conversation ?? "");
      } else {
        text = "";
      }
      if (!text && msg.caption) text = String(msg.caption);

      if (phone) return { phone, text, fromMe };
    }

    // Tenta extrair de body.message (objeto singular com o texto)
    const chatPhone = String(chat?.phone ?? "").replace(/\D/g, "");
    if (chatPhone) {
      let text = "";
      let fromMe = false;

      if (msgObj) {
        // message é objeto: { body, text, conversation, fromMe, ... }
        text =
          (typeof msgObj.body === "string" ? msgObj.body : "") ||
          (typeof msgObj.text === "string" ? msgObj.text : "") ||
          (typeof msgObj.conversation === "string" ? msgObj.conversation : "") ||
          (typeof msgObj.caption === "string" ? msgObj.caption : "") ||
          ((msgObj.extendedTextMessage as Record<string, string> | undefined)?.text ?? "") ||
          "";
        fromMe = msgObj.fromMe === true || msgObj.fromMe === "true";
      } else if (typeof body.message === "string") {
        text = body.message;
        fromMe = body.fromMe === true;
      }

      // Fallback: body na raiz
      if (!text) {
        text =
          (typeof body.body === "string" ? body.body : "") ||
          (typeof body.text === "string" ? body.text : "") ||
          "";
      }

      return { phone: chatPhone, text, fromMe };
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

  console.log(`[webhook/${instanceId}] body=`, JSON.stringify(body).slice(0, 4000));

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
    console.log(`[webhook/${instanceId}] extracted=`, JSON.stringify(extracted));
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

    // Mensagem enviada por você (gestor)
    if (fromMe) {
      if (cid !== "sem-cliente") {
        const agCfg = getClientById(cid)?.agentConfig;
        const resumeKeyword = agCfg?.aiResumeKeyword?.trim();
        // Palavra-chave de retomada: reativa a IA sem pausar
        if (resumeKeyword && text.trim().toLowerCase() === resumeKeyword.toLowerCase()) {
          upsertLeadByPhone(cid, phone, { funnelId, aiPaused: false });
          console.log(`[webhook/${instanceId}] IA REATIVADA para phone=${phone} via keyword`);
        } else {
          // Qualquer outra mensagem do gestor pausa a IA automaticamente
          upsertLeadByPhone(cid, phone, { funnelId, aiPaused: true });
          console.log(`[webhook/${instanceId}] IA PAUSADA para phone=${phone} (mensagem do gestor)`);
        }
      }
      return NextResponse.json({ ok: true });
    }

    // ── Envia mídia na primeira interação do lead ─────────────────────────
    if (isNew && cid !== "sem-cliente") {
      const mediaItems = getClientById(cid)?.agentConfig?.mediaLibrary?.filter((m) => m.sendOnFirstContact) ?? [];
      for (const media of mediaItems) {
        await sendMedia(instanceUazToken, phone, media.type, media.url, media.caption, media.filename);
        await new Promise<void>((r) => setTimeout(r, 800));
      }
    }

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
    console.log(`[webhook/${instanceId}] phone=${phone} cid=${cid} funnel=${funnel?.id?.slice(0,8) ?? "none"}(${matchSource}) gemini=${geminiEnabled} wait=${waitSeconds}s uazToken=${instanceUazToken.slice(0, 8)}...`);

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
        console.log(`[webhook/${instanceId}] Gemini batch iniciando para phone=${phone} cid=${cid} msgs=${batch.messages.length}`);
        runGeminiAgent(combined, h, cid, phone)
          .then(async ({ text: geminiText, actions }) => {
            markDone(batch.id);
            console.log(`[webhook/${instanceId}] Gemini respondeu (${geminiText?.length ?? 0} chars) para ${phone}`);
            const agCfg = getClientById(cid)?.agentConfig;
            const clientName = getClientById(cid)?.name ?? cid;
            if (geminiText) {
              addMessage(phone, { role: "assistant", content: geminiText, ts: Date.now() }, clientId);
              const { clean, names } = extractMediaMarkers(geminiText);
              const textToSend = clean || geminiText;
              const chunks = agCfg?.splitMessages
                ? splitMessage(textToSend, agCfg.maxMessageLength ?? 300)
                : [textToSend];
              for (let i = 0; i < chunks.length; i++) {
                const sent = await sendText(instanceUazToken, phone, chunks[i]);
                console.log(`[webhook/${instanceId}] sendText[${i + 1}/${chunks.length}] result=${sent} token=${instanceUazToken.slice(0, 8)}... phone=${phone}`);
                if (i < chunks.length - 1) await new Promise<void>((r) => setTimeout(r, 700));
              }
              if (names.length > 0 && agCfg?.mediaLibrary?.length) {
                await sendMarkedMedia(instanceUazToken, phone, names, agCfg.mediaLibrary);
              }
            }
            if (agCfg && actions.length > 0) {
              await processGeminiActions(actions, instanceUazToken, clientName, agCfg, phone);
            }
          })
          .catch((e) => {
            console.error(`[webhook/${instanceId}] Gemini ERRO para phone=${phone}:`, e);
            markDone(batch.id);
          });
      }, waitSeconds * 1000);

      return NextResponse.json({ ok: true });
    }

    // Resposta imediata (waitSeconds = 0)
    if (!geminiEnabled || cid === "sem-cliente") return NextResponse.json({ ok: true });

    console.log(`[webhook/${instanceId}] Gemini imediato iniciando para phone=${phone}`);
    const { text: geminiText, actions: geminiActions } = await runGeminiAgent(text, history, cid, phone);
    console.log(`[webhook/${instanceId}] Gemini imediato respondeu (${geminiText?.length ?? 0} chars)`);
    if (!geminiText && geminiActions.length === 0) return NextResponse.json({ ok: true });

    if (geminiText) {
      addMessage(phone, { role: "assistant", content: geminiText, ts: Date.now() }, clientId);
      const { clean, names } = extractMediaMarkers(geminiText);
      const textToSend = clean || geminiText;
      const chunks = agentCfg?.splitMessages
        ? splitMessage(textToSend, agentCfg.maxMessageLength ?? 300)
        : [textToSend];
      for (let i = 0; i < chunks.length; i++) {
        const sent = await sendText(instanceUazToken, phone, chunks[i]);
        console.log(`[webhook/${instanceId}] sendText[${i + 1}/${chunks.length}] result=${sent}`);
        if (i < chunks.length - 1) await new Promise<void>((r) => setTimeout(r, 700));
      }
      if (names.length > 0 && agentCfg?.mediaLibrary?.length) {
        await sendMarkedMedia(instanceUazToken, phone, names, agentCfg.mediaLibrary);
      }
    }
    if (agentCfg && geminiActions.length > 0) {
      const clientName = getClientById(cid)?.name ?? cid;
      await processGeminiActions(geminiActions, instanceUazToken, clientName, agentCfg, phone);
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(`[webhook/${instanceId}] Erro:`, err);
    return NextResponse.json({ ok: true }); // sempre 200 para evitar reenvios
  }
}

export async function GET() {
  return NextResponse.json({ status: "online", webhook: "per-instance" });
}
