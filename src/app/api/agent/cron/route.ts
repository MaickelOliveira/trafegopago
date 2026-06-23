import { NextRequest, NextResponse } from "next/server";
import { getDueFollowUps, markSent, cancelFollowUp, scheduleFollowUp, cancelFollowUpsForPhone, type FollowUp } from "@/lib/followups";
import { getDuePending, markProcessing, markDone } from "@/lib/pending-responses";
import { getClientById, getConfig, getAgentConfigForConnection } from "@/lib/clients";
import { sendMessage, getGeminiApiKey } from "@/lib/whatsapp-send";
import { runGeminiAgent } from "@/lib/gemini-agent";
import { addMessage, getHistory } from "@/lib/conversations";
import { runScheduledDailyAutomations } from "@/lib/crm-automations";
import { getLeadByPhone } from "@/lib/leads";
import { getFunnels } from "@/lib/funnels";
import { getTemplateById, sendTemplate } from "@/lib/waba-templates";
import { GoogleGenerativeAI } from "@google/generative-ai";
import type { ChatMessage } from "@/lib/conversations";

// Envia o follow-up via template aprovado da Meta (obrigatório fora da janela
// de 24h da API oficial). Resolve phoneNumberId/token pela conexão de origem
// (followUp.connId) e ordena as variáveis numericamente ("1","2",... → {{1}},{{2}}).
async function sendFollowUpTemplate(followUp: FollowUp): Promise<boolean> {
  if (!followUp.templateId) return false;
  const template = getTemplateById(followUp.templateId);
  if (!template) {
    console.error(`[agent/cron] FU ${followUp.id}: template ${followUp.templateId} não encontrado`);
    return false;
  }
  const conn = getFunnels()
    .flatMap((f) => f.connections ?? [])
    .find((c) => c.id === followUp.connId && c.type === "meta");
  if (!conn?.metaPhoneNumberId || !conn?.metaToken) {
    console.error(`[agent/cron] FU ${followUp.id}: conexão Meta não encontrada para connId=${followUp.connId}`);
    return false;
  }
  const vars = followUp.templateVariables ?? {};
  const orderedValues = Object.keys(vars)
    .sort((a, b) => Number(a) - Number(b))
    .map((k) => vars[k]);
  const components = orderedValues.length > 0
    ? [{ type: "body", parameters: orderedValues.map((v) => ({ type: "text", text: v })) }]
    : undefined;
  const result = await sendTemplate(conn.metaPhoneNumberId, conn.metaToken, followUp.phone, template.name, template.language, components);
  if (!result.success) {
    console.error(`[agent/cron] FU ${followUp.id}: sendTemplate falhou — ${result.error}`);
    return false;
  }
  return true;
}

const TERMINAL_STATUSES = ["ganho", "perdido"];

// Decide via Gemini se o follow-up deve ser enviado para este lead
async function shouldSendFollowUp(
  history: ChatMessage[],
  systemPrompt: string,
  followUpMsg: string,
  apiKey: string,
): Promise<boolean> {
  const recent = history.slice(-10);
  const transcript = recent
    .map((m) => `${m.role === "user" ? "Lead" : "Agente"}: ${m.content.slice(0, 300)}`)
    .join("\n");

  const prompt =
    `Você decide se um follow-up automático deve ser enviado a um lead.\n\n` +
    `Contexto do negócio:\n${systemPrompt ? systemPrompt.slice(0, 800) : "(não informado)"}\n\n` +
    `Últimas mensagens da conversa:\n${transcript}\n\n` +
    `Follow-up que seria enviado: "${followUpMsg.slice(0, 200)}"\n\n` +
    `Responda APENAS com JSON válido: {"enviar": true, "motivo": "..."} ou {"enviar": false, "motivo": "..."}\n\n` +
    `NÃO enviar se:\n` +
    `- Lead disse explicitamente que não tem interesse ou não vai comprar/reservar\n` +
    `- Conversa é com fornecedor, parceiro, concorrente ou funcionário\n` +
    `- Conversa é pessoal e não tem relação com o produto/serviço\n` +
    `- Lead já concluiu a compra/reserva e não precisa de follow-up\n` +
    `- Lead pediu para não ser mais contactado\n\n` +
    `ENVIAR se:\n` +
    `- Lead demonstrou interesse mas não fechou negócio\n` +
    `- Lead pediu para retornar depois ou está avaliando\n` +
    `- Lead não respondeu após receber proposta, orçamento ou informações\n` +
    `- Conversa ficou inconclusiva ou lead sumiu no meio do atendimento`;

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: "gemini-3.1-flash-lite" });
    const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), 12_000));
    const result = await Promise.race([model.generateContent(prompt), timeout]);
    if (!result) {
      console.log("[agent/cron] shouldSendFollowUp: timeout → enviando por segurança");
      return true;
    }
    const text = (result as Awaited<ReturnType<typeof model.generateContent>>).response.text().trim();
    const jsonMatch = text.match(/\{[\s\S]*?\}/);
    if (!jsonMatch) return true;
    const parsed = JSON.parse(jsonMatch[0]) as { enviar: boolean; motivo?: string };
    console.log(`[agent/cron] shouldSendFollowUp: enviar=${parsed.enviar} motivo="${parsed.motivo ?? ""}"`);
    return parsed.enviar !== false;
  } catch (e) {
    console.error("[agent/cron] shouldSendFollowUp erro:", e);
    return true; // em caso de erro, envia por segurança
  }
}

// Gera mensagem de follow-up com IA usando o histórico da conversa
async function generateAiFollowUp(
  history: ChatMessage[],
  systemPrompt: string,
  instruction: string,
  apiKey: string,
): Promise<string | null> {
  const recent = history.slice(-10);
  const transcript = recent
    .map((m) => `${m.role === "user" ? "Lead" : "Agente"}: ${m.content.slice(0, 300)}`)
    .join("\n");

  const prompt =
    (systemPrompt ? `Contexto do negócio:\n${systemPrompt.slice(0, 600)}\n\n` : "") +
    `Você é o agente de atendimento. Escreva uma mensagem de follow-up para retomar contato com este lead.\n\n` +
    `Histórico recente:\n${transcript}\n\n` +
    `Diretriz para o follow-up: ${instruction}\n\n` +
    `Escreva a mensagem em português, de forma natural e calorosa, sem asteriscos nem formatação Markdown. Máximo 3 linhas curtas.`;

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: "gemini-3.1-flash-lite" });
    const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), 15_000));
    const result = await Promise.race([model.generateContent(prompt), timeout]);
    if (!result) return null;
    const text = (result as Awaited<ReturnType<typeof model.generateContent>>).response.text().trim();
    return text || null;
  } catch (e) {
    console.error("[agent/cron] generateAiFollowUp erro:", e);
    return null;
  }
}

// GET /api/agent/cron?secret=xxx
// Chamado pelo EasyPanel a cada 15 min para processar follow-ups vencidos
export async function GET(req: NextRequest) {
  const { agentCronSecret } = getConfig();
  const secret = req.nextUrl.searchParams.get("secret");

  if (agentCronSecret && secret !== agentCronSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const due = getDueFollowUps();
  let processed = 0;
  let skipped = 0;

  for (const followUp of due) {
    const client = getClientById(followUp.clientId);
    const agentCfg = client
      ? (getAgentConfigForConnection(client, undefined) ?? client.agentConfig)
      : undefined;

    if (agentCfg?.followUpEnabled === false) {
      skipped++;
      continue;
    }

    try {
      // ── 0. Lead em coluna final (ganho/perdido) → cancela todos e pula ───
      const lead = getLeadByPhone(followUp.clientId, followUp.phone);
      if (lead && TERMINAL_STATUSES.includes(lead.status)) {
        cancelFollowUpsForPhone(followUp.clientId, followUp.phone);
        console.log(`[agent/cron] FU ${followUp.id} cancelado: lead em coluna final (${lead.status})`);
        skipped++;
        continue;
      }

      // ── 1. Checar quem enviou a última mensagem ──────────────────────────
      const history = getHistory(followUp.phone, followUp.clientId);
      const lastMsg = history[history.length - 1];

      if (lastMsg?.role === "user") {
        // Lead já respondeu depois do follow-up ser agendado → descarta
        markSent(followUp.id);
        console.log(`[agent/cron] FU ${followUp.id} descartado: última mensagem foi do lead`);
        skipped++;
        continue;
      }

      // ── 2. Análise Gemini: deve enviar? ─────────────────────────────────
      const apiKey = getGeminiApiKey(agentCfg?.geminiApiKey ?? undefined);
      // Usa followUpContext (campo dedicado) se preenchido; senão cai nos primeiros 800 chars do systemPrompt
      const systemPrompt = agentCfg?.followUpContext?.trim()
        || (agentCfg?.systemPrompt ?? "").slice(0, 800);

      if (apiKey && history.length > 0) {
        const send = await shouldSendFollowUp(history, systemPrompt, followUp.message, apiKey);
        if (!send) {
          cancelFollowUp(followUp.id);
          console.log(`[agent/cron] FU ${followUp.id} cancelado pela análise Gemini (contexto inadequado)`);
          skipped++;
          continue;
        }
      }

      // ── 3. Determinar mensagem: texto fixo ou geração AI ─────────────────
      let msgToSend = followUp.message;
      if (followUp.messageType === "ai" && apiKey && history.length > 0) {
        const aiCtx = agentCfg?.followUpContext?.trim() || (agentCfg?.systemPrompt ?? "").slice(0, 600);
        const aiMsg = await generateAiFollowUp(history, aiCtx, followUp.message, apiKey);
        if (aiMsg) {
          msgToSend = aiMsg;
          console.log(`[agent/cron] FU ${followUp.id} mensagem AI: "${aiMsg.slice(0, 80)}"`);
        }
      }

      // ── 4. Enviar (sempre pela MESMA conexão/número da conversa original) ──
      // Template é OBRIGATÓRIO para API oficial Meta fora da janela de 24h —
      // texto livre (mesmo gerado por IA) é rejeitado pela Meta nesse caso.
      let sent: boolean;
      if (followUp.messageType === "template") {
        sent = await sendFollowUpTemplate(followUp);
      } else {
        sent = await sendMessage(followUp.phone, msgToSend, followUp.clientId, followUp.connId);
      }
      if (sent) {
        // Registra no histórico para aparecer no inbox da plataforma
        addMessage(followUp.phone, { role: "assistant", content: msgToSend, ts: Date.now() }, followUp.clientId, { connId: followUp.connId });
      } else {
        console.error(`[agent/cron] FU ${followUp.id} FALHOU ao enviar — phone=${followUp.phone} messageType=${followUp.messageType ?? "text"}`);
      }
      markSent(followUp.id);
      processed++;
      console.log(`[agent/cron] Follow-up ${sent ? "enviado" : "FALHOU"}: ${followUp.id} → ${followUp.phone}`);

      // ── 5. Agendar próximo step ──────────────────────────────────────────
      const steps = agentCfg?.followUps ?? [];
      const nextIdx = (followUp.stepIndex ?? 0) + 1;
      const nextStep = steps[nextIdx];
      if (nextStep && agentCfg?.followUpEnabled) {
        const scheduledAt = new Date(Date.now() + nextStep.delayHours * 3600000).toISOString();
        scheduleFollowUp({
          clientId: followUp.clientId,
          phone: followUp.phone,
          scheduledAt,
          message: nextStep.message,
          type: "followup",
          stepIndex: nextIdx,
          stepId: nextStep.id,
          messageType: nextStep.messageType as "text" | "ai" | "template" | undefined,
          templateId: nextStep.templateId,
          templateVariables: nextStep.templateVariables,
          connId: followUp.connId,
        });
        console.log(`[agent/cron] Próximo step ${nextIdx} agendado para ${scheduledAt}`);
      }
    } catch (e) {
      console.error(`[agent/cron] Erro ao enviar ${followUp.id}:`, e);
    }
  }

  // ── Processa batches de mensagens vencidos ───────────────────────────────
  const pendingBatches = getDuePending();
  let batchesProcessed = 0;

  for (const batch of pendingBatches) {
    const client = getClientById(batch.clientId);
    if (!client?.agentConfig?.enabled) continue;

    try {
      markProcessing(batch.id);
      const combined = batch.messages.join("\n");
      const history = getHistory(batch.phone);
      const { text: reply } = await runGeminiAgent(combined, history, batch.clientId, batch.phone);
      markDone(batch.id);

      if (reply) {
        addMessage(batch.phone, { role: "assistant", content: reply, ts: Date.now() }, batch.clientId);
        await sendMessage(
          batch.phone, reply, batch.clientId,
          client.agentConfig.whatsappConnectionId
        );
        batchesProcessed++;
      }
    } catch (e) {
      console.error(`[agent/cron] Erro ao processar batch ${batch.id}:`, e);
      markDone(batch.id);
    }
  }

  // ── Automações CRM agendadas (scheduled_daily) ───────────────────────────
  runScheduledDailyAutomations();

  return NextResponse.json({ ok: true, processed, skipped, total: due.length, batchesProcessed });
}
