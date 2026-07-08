// Processamento unificado de follow-ups e batches de mensagens vencidos.
// Usado tanto pelo agendador interno (instrumentation.ts, a cada 60s) quanto
// pela rota HTTP /api/agent/cron (acionável externamente, ex: EasyPanel).
// Antes existiam DUAS implementações divergentes que competiam pelos mesmos
// follow-ups — unificadas aqui para evitar comportamento inconsistente.
import { getDueFollowUps, markSent, markFailed, cancelFollowUp, scheduleFollowUp, cancelFollowUpsForPhone, type FollowUp } from "./followups";
import { getDuePending, markProcessing, markDone } from "./pending-responses";
import { getClientById, getAllAgentConfigs, type AgentConfig } from "./clients";
import { sendMessage, getGeminiApiKey } from "./whatsapp-send";
import { runGeminiAgent, generateFollowUpAI } from "./gemini-agent";
import { addMessage, getHistory, setAiPaused, type ChatMessage } from "./conversations";
import { runScheduledDailyAutomations } from "./crm-automations";
import { getLeadByPhone, updateLead } from "./leads";
import { getFunnels, getFunnelById } from "./funnels";
import { getTemplateById, sendTemplate } from "./waba-templates";
import { GoogleGenerativeAI } from "@google/generative-ai";

const TERMINAL_STATUSES = ["ganho", "perdido"];

/** Monta um texto legível do template (corpo + variáveis substituídas) para exibir no histórico/inbox */
function renderTemplatePreview(templateId: string | undefined, variables: Record<string, string> | undefined): string {
  if (!templateId) return "";
  const template = getTemplateById(templateId);
  if (!template) return "";
  const body = template.components.find((c) => c.type === "BODY")?.text ?? "";
  if (!variables) return body;
  const ordered = Object.keys(variables).sort((a, b) => Number(a) - Number(b));
  return ordered.reduce((text, key, i) => text.replace(`{{${i + 1}}}`, variables[key]), body);
}

/** Interpola variáveis {{nome}}, {{nome_completo}}, {{telefone}}, {{email}} em texto fixo */
function interpolateFollowUp(msg: string, lead: { name?: string | null; phone?: string | null; email?: string | null } | undefined): string {
  if (!msg) return msg;
  const firstName = lead?.name ? lead.name.split(" ")[0] : "";
  return msg
    .replace(/\{\{nome\}\}/g, firstName)
    .replace(/\{\{nome_completo\}\}/g, lead?.name ?? "")
    .replace(/\{\{telefone\}\}/g, lead?.phone ?? "")
    .replace(/\{\{email\}\}/g, lead?.email ?? "");
}

// Envia o follow-up via template aprovado da Meta (obrigatório fora da janela
// de 24h da API oficial). Resolve phoneNumberId/token pela conexão de origem
// (followUp.connId) e ordena as variáveis numericamente ("1","2",... → {{1}},{{2}}).
async function sendFollowUpTemplate(followUp: FollowUp): Promise<{ ok: boolean; error?: string; wamid?: string }> {
  if (!followUp.templateId) return { ok: false, error: "followUp sem templateId" };
  const template = getTemplateById(followUp.templateId);
  if (!template) {
    const error = `template ${followUp.templateId} não encontrado`;
    console.error(`[cron-tasks] FU ${followUp.id}: ${error}`);
    return { ok: false, error };
  }
  const conn = getFunnels()
    .flatMap((f) => f.connections ?? [])
    .find((c) => c.id === followUp.connId && c.type === "meta");
  if (!conn?.metaPhoneNumberId || !conn?.metaToken) {
    const error = `conexão Meta não encontrada para connId=${followUp.connId}`;
    console.error(`[cron-tasks] FU ${followUp.id}: ${error}`);
    return { ok: false, error };
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
    console.error(`[cron-tasks] FU ${followUp.id}: sendTemplate falhou — ${result.error}`);
    return { ok: false, error: result.error ?? "sendTemplate falhou sem detalhe" };
  }
  return { ok: true, wamid: result.wamid };
}

// Decide via Gemini se o follow-up ainda deve ser enviado, dado o contexto atual da conversa
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
      console.log("[cron-tasks] shouldSendFollowUp: timeout → enviando por segurança");
      return true;
    }
    const text = (result as Awaited<ReturnType<typeof model.generateContent>>).response.text().trim();
    const jsonMatch = text.match(/\{[\s\S]*?\}/);
    if (!jsonMatch) return true;
    const parsed = JSON.parse(jsonMatch[0]) as { enviar: boolean; motivo?: string };
    console.log(`[cron-tasks] shouldSendFollowUp: enviar=${parsed.enviar} motivo="${parsed.motivo ?? ""}"`);
    return parsed.enviar !== false;
  } catch (e) {
    console.error("[cron-tasks] shouldSendFollowUp erro:", e);
    return true; // em caso de erro, envia por segurança
  }
}

// Encontra o agentConfig "dono" deste follow-up — pelo stepId configurado,
// com fallback para qualquer config com followUpEnabled.
function resolveAgentConfig(allCfgs: AgentConfig[], stepId: string | undefined): AgentConfig | undefined {
  return allCfgs.find((c) => c.followUpEnabled && c.followUps?.some((s) => s.id === stepId))
    ?? allCfgs.find((c) => c.followUpEnabled);
}

export async function processDueFollowUpsAndBatches(): Promise<{
  processed: number; skipped: number; total: number; batchesProcessed: number;
}> {
  const due = getDueFollowUps();
  let processed = 0;
  let skipped = 0;

  for (const followUp of due) {
    const client = getClientById(followUp.clientId);
    const agentCfg = client ? resolveAgentConfig(getAllAgentConfigs(client), followUp.stepId) : undefined;

    if (!agentCfg?.followUpEnabled) {
      skipped++;
      continue;
    }

    try {
      // ── 0. Lead em coluna final (ganho/perdido) → cancela todos e pula ───
      const lead = getLeadByPhone(followUp.clientId, followUp.phone);
      if (lead && TERMINAL_STATUSES.includes(lead.status)) {
        cancelFollowUpsForPhone(followUp.clientId, followUp.phone);
        console.log(`[cron-tasks] FU ${followUp.id} cancelado: lead em coluna final (${lead.status})`);
        skipped++;
        continue;
      }

      // ── 0.1. Lead em coluna marcada como "bloqueia follow-up" (ex: atendente
      // já está cuidando do caso manualmente) → cancela todos e pula ──────────
      const followUpFunnel = lead ? getFunnelById(lead.funnelId) : undefined;
      const followUpColumn = followUpFunnel?.columns.find((c) => c.id === lead?.status);
      if (followUpColumn?.blockFollowUps) {
        cancelFollowUpsForPhone(followUp.clientId, followUp.phone);
        console.log(`[cron-tasks] FU ${followUp.id} cancelado: lead em coluna com follow-up bloqueado (${followUpColumn.label})`);
        skipped++;
        continue;
      }

      // ── 1. Checar quem enviou a última mensagem ──────────────────────────
      const history = getHistory(followUp.phone, followUp.clientId, followUp.connId);
      const lastMsg = history[history.length - 1];

      if (lastMsg?.role === "user") {
        // Lead já respondeu depois do follow-up ser agendado → descarta
        markSent(followUp.id);
        console.log(`[cron-tasks] FU ${followUp.id} descartado: última mensagem foi do lead`);
        skipped++;
        continue;
      }

      // ── 2. Análise Gemini: deve enviar? ─────────────────────────────────
      // Só se aplica a conexões WPPConnect/UazAPI (texto livre). Na API oficial
      // (Meta) o follow-up já depende de template aprovado — a checagem de
      // "contexto inadequado" não se aplica e só causava cancelamentos indevidos.
      const apiKey = getGeminiApiKey(agentCfg.geminiApiKey);
      const systemPrompt = agentCfg.followUpContext?.trim() || (agentCfg.systemPrompt ?? "").slice(0, 800);
      const followUpConn = getFunnels()
        .flatMap((f) => f.connections ?? [])
        .find((c) => c.id === followUp.connId);
      const isMetaConn = followUpConn?.type === "meta";

      if (!isMetaConn && apiKey && history.length > 0) {
        const send = await shouldSendFollowUp(history, systemPrompt, followUp.message, apiKey);
        if (!send) {
          cancelFollowUp(followUp.id);
          console.log(`[cron-tasks] FU ${followUp.id} cancelado pela análise Gemini (contexto inadequado)`);
          skipped++;
          continue;
        }
      }

      // ── 3. Determinar mensagem: template / IA / texto fixo com interpolação ──
      let msgToSend = followUp.message;
      if (followUp.messageType === "ai" && apiKey) {
        const aiMsg = await generateFollowUpAI(history, lead?.name ?? undefined, client?.name ?? followUp.clientId, apiKey, systemPrompt);
        if (aiMsg) {
          msgToSend = aiMsg;
          console.log(`[cron-tasks] FU ${followUp.id} mensagem AI: "${aiMsg.slice(0, 80)}"`);
        }
      } else if (followUp.messageType === "template") {
        // followUp.message vem vazio para templates — o conteúdo real está no
        // template aprovado da Meta. Resolve um preview legível só para exibir
        // no histórico/inbox da plataforma (o envio em si usa sendFollowUpTemplate).
        msgToSend = renderTemplatePreview(followUp.templateId, followUp.templateVariables) || followUp.message;
      } else {
        msgToSend = interpolateFollowUp(followUp.message, lead);
      }

      // Resolve número real quando o contato é um LID (ID interno do WhatsApp)
      const sendPhone = lead?.realPhone || followUp.phone;

      // ── 4. Enviar (sempre pela MESMA conexão/número da conversa original) ──
      // Template é OBRIGATÓRIO para API oficial Meta fora da janela de 24h —
      // texto livre (mesmo gerado por IA) é rejeitado pela Meta nesse caso.
      let sendResult: { ok: boolean; error?: string; wamid?: string };
      if (followUp.messageType === "template") {
        sendResult = await sendFollowUpTemplate(followUp);
      } else {
        const ok = await sendMessage(sendPhone, msgToSend, followUp.clientId, followUp.connId);
        sendResult = { ok, error: ok ? undefined : "sendMessage falhou — ver logs de sendMessageDirect/sendWhatsApp" };
      }

      if (sendResult.ok) {
        // Registra no histórico para aparecer no inbox da plataforma
        addMessage(followUp.phone, { role: "assistant", content: msgToSend, ts: Date.now() }, followUp.clientId, { connId: followUp.connId });
        // Reativa a IA (caso estivesse pausada) para que responda quando o lead reagir
        if (lead?.aiPaused) {
          setAiPaused(followUp.phone, false, followUp.clientId);
          updateLead(lead.id, { aiPaused: false });
        }
        // wamid guardado para casar com o status assíncrono (sent/delivered/read/failed)
        // que a Meta manda depois via webhook — a API pode aceitar o envio aqui e
        // falhar a entrega de verdade só mais tarde, fora dessa resposta síncrona.
        markSent(followUp.id, sendResult.wamid);
      } else {
        // NÃO marca como "sent" — registra "failed" com o motivo real, visível
        // em /api/debug/followups, em vez de mascarar a falha como sucesso.
        console.error(`[cron-tasks] FU ${followUp.id} FALHOU ao enviar — phone=${followUp.phone} messageType=${followUp.messageType ?? "text"} erro="${sendResult.error}"`);
        markFailed(followUp.id, sendResult.error ?? "falha desconhecida");
      }
      processed++;
      console.log(`[cron-tasks] Follow-up ${sendResult.ok ? "enviado" : "FALHOU"}: ${followUp.id} → ${followUp.phone}`);

      // ── 5. Agendar próximo step (somente se o envio atual teve sucesso) ────
      const steps = agentCfg.followUps ?? [];
      const nextIdx = (followUp.stepIndex ?? 0) + 1;
      const nextStep = sendResult.ok ? steps[nextIdx] : undefined;
      if (nextStep) {
        const scheduledAt = new Date(Date.now() + nextStep.delayHours * 3600000).toISOString();
        scheduleFollowUp({
          clientId: followUp.clientId,
          phone: followUp.phone,
          scheduledAt,
          message: nextStep.message,
          type: "followup",
          stepIndex: nextIdx,
          stepId: nextStep.id,
          messageType: nextStep.messageType,
          templateId: nextStep.templateId,
          templateVariables: nextStep.templateVariables,
          connId: followUp.connId,
        });
        console.log(`[cron-tasks] Próximo step ${nextIdx} agendado para ${scheduledAt}`);
      }
    } catch (e) {
      console.error(`[cron-tasks] Erro ao enviar ${followUp.id}:`, e);
      markFailed(followUp.id, e instanceof Error ? e.message : String(e));
    }
  }

  // ── Processa batches de mensagens vencidos ───────────────────────────────
  const pendingBatches = getDuePending();
  let batchesProcessed = 0;

  for (const batch of pendingBatches) {
    const client = getClientById(batch.clientId);
    if (!client) continue;
    const agentCfg = getAllAgentConfigs(client).find((c) => c.enabled);
    if (!agentCfg) continue;

    try {
      markProcessing(batch.id);
      const combined = batch.messages.join("\n");
      const history = getHistory(batch.phone);
      const { text: reply } = await runGeminiAgent(combined, history, batch.clientId, batch.phone, agentCfg.whatsappConnectionId);
      markDone(batch.id);

      if (reply) {
        addMessage(batch.phone, { role: "assistant", content: reply, ts: Date.now() }, batch.clientId);
        await sendMessage(batch.phone, reply, batch.clientId, agentCfg.whatsappConnectionId);
        batchesProcessed++;
      }
    } catch (e) {
      console.error(`[cron-tasks] Erro ao processar batch ${batch.id}:`, e);
      markDone(batch.id);
    }
  }

  // ── Automações CRM agendadas (scheduled_daily) ───────────────────────────
  runScheduledDailyAutomations();

  return { processed, skipped, total: due.length, batchesProcessed };
}
