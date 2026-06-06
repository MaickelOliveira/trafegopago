export async function register() {
  if (process.env.NEXT_RUNTIME === "edge") return;

  try {
    const { getDueFollowUps, markSent, scheduleFollowUp } = await import("./lib/followups");
    const { getDuePending, markProcessing, markDone } = await import("./lib/pending-responses");
    const { sendMessage } = await import("./lib/whatsapp-send");
    const { runGeminiAgent, generateFollowUpAI } = await import("./lib/gemini-agent");
    const { addMessage, getHistory, setAiPaused } = await import("./lib/conversations");
    const { getClientById, getAllAgentConfigs, getConfig } = await import("./lib/clients");
    const { getLeadByPhone, updateLead } = await import("./lib/leads");
    const { getGeminiApiKey } = await import("./lib/whatsapp-send");

    console.log("[cron] Agendador interno iniciado — verificação a cada 60s");

    // ── Re-registra webhooks WPPConnect no servidor ao iniciar ────────────
    // O servidor WPPConnect armazena webhooks em memória — perde após restart.
    // Aguarda 8s para o servidor estabilizar antes de tentar.
    setTimeout(async () => {
      try {
        const { getWppSessions } = await import("./lib/wppconnect-sessions");
        const { checkConnectionStatus, startSession } = await import("./lib/wppconnect-api");
        const appBaseUrl = getConfig().appBaseUrl?.replace(/\/$/, "");
        if (!appBaseUrl) {
          console.log("[cron] appBaseUrl não configurado — skip re-registro de webhooks WPPConnect");
          return;
        }
        const sessions = getWppSessions();
        for (const wpp of sessions) {
          const webhookUrl = `${appBaseUrl}/api/whatsapp/webhook/wppconnect/${wpp.id}`;
          try {
            const status = await checkConnectionStatus(wpp.sessionName, wpp.sessionToken);
            if (status === "CONNECTED") {
              await startSession(wpp.sessionName, wpp.sessionToken, webhookUrl);
              console.log(`[cron] webhook re-registrado: ${wpp.sessionName} → ${webhookUrl}`);
            } else {
              console.log(`[cron] skip webhook re-registro: ${wpp.sessionName} status=${status}`);
            }
          } catch (e) {
            console.error(`[cron] erro ao re-registrar webhook ${wpp.sessionName}:`, e);
          }
        }
      } catch (e) {
        console.error("[cron] erro no re-registro de webhooks:", e);
      }
    }, 8000);

    /** Interpola variáveis {{nome}}, {{nome_completo}}, {{telefone}}, {{email}} */
    function interpolateFollowUp(msg: string, lead: { name?: string | null; phone?: string | null; email?: string | null } | undefined): string {
      if (!msg) return msg;
      const firstName = lead?.name ? lead.name.split(" ")[0] : "";
      return msg
        .replace(/\{\{nome\}\}/g, firstName)
        .replace(/\{\{nome_completo\}\}/g, lead?.name ?? "")
        .replace(/\{\{telefone\}\}/g, lead?.phone ?? "")
        .replace(/\{\{email\}\}/g, lead?.email ?? "");
    }

    const tick = async () => {
      try {
        // ── Follow-ups vencidos ────────────────────────────────────────────
        const due = getDueFollowUps();
        for (const fu of due) {
          const client = getClientById(fu.clientId);
          if (!client) continue;
          // Procura em todos os agentConfigs do cliente qual tem followUpEnabled
          const allCfgs = getAllAgentConfigs(client);
          // Encontra o agentConfig dono deste step (pelo stepId) para usar a conexão certa
          const agCfg = allCfgs.find(c => c.followUpEnabled && c.followUps?.some(s => s.id === fu.stepId))
            ?? allCfgs.find(c => c.followUpEnabled);
          if (!agCfg) continue;
          try {
            const lead = getLeadByPhone(fu.clientId, fu.phone);

            // Usa realPhone se disponível (resolve LID para número real)
            const sendPhone = lead?.realPhone || fu.phone;
            console.log(`[cron] follow-up id=${fu.id} phone=${fu.phone} sendPhone=${sendPhone} type=${fu.messageType} connId=${agCfg.whatsappConnectionId}`);

            if (fu.messageType === "template") {
              // Envia template Meta aprovado
              const { getTemplateById, sendTemplate } = await import("./lib/waba-templates");
              const tpl = fu.templateId ? getTemplateById(fu.templateId) : null;
              if (tpl && tpl.status === "APPROVED" && tpl.phoneNumberId && tpl.metaToken) {
                await sendTemplate(tpl.phoneNumberId, tpl.metaToken, sendPhone, tpl.name, tpl.language);
              } else {
                console.warn(`[cron] template não encontrado/aprovado para fu=${fu.id}`);
              }
            } else if (fu.messageType === "ai") {
              // Gera follow-up com IA baseado no histórico da conversa
              const history = getHistory(fu.phone);
              const apiKey = getGeminiApiKey(agCfg.geminiApiKey);
              if (!apiKey) {
                console.error(`[cron] sem geminiApiKey para fu=${fu.id} — follow-up AI não enviado`);
              } else {
                const aiMsg = await generateFollowUpAI(history, lead?.name, client.name, apiKey);
                if (aiMsg) {
                  console.log(`[cron] AI gerou mensagem para ${sendPhone}: "${aiMsg.slice(0, 80)}"`);
                  // Salva no histórico ANTES de enviar — usado pelo webhook para
                  // reconhecer o eco fromMe e não pausar a IA
                  addMessage(fu.phone, { role: "assistant", content: aiMsg, ts: Date.now() }, fu.clientId);
                  await sendMessage(sendPhone, aiMsg, fu.clientId, agCfg.whatsappConnectionId);
                } else {
                  console.error(`[cron] generateFollowUpAI retornou null para fu=${fu.id}`);
                }
              }
            } else {
              // Texto fixo com interpolação de variáveis
              const interpolated = interpolateFollowUp(fu.message, lead);
              console.log(`[cron] enviando texto fixo para ${fu.phone}: "${interpolated.slice(0, 80)}"`);
              await sendMessage(fu.phone, interpolated, fu.clientId, agCfg.whatsappConnectionId);
            }

            markSent(fu.id);

            // Re-ativa a IA após o follow-up para que ela possa responder quando o lead reagir
            const leadAfterSend = getLeadByPhone(fu.clientId, fu.phone);
            if (leadAfterSend?.aiPaused) {
              setAiPaused(fu.phone, false, fu.clientId);
              updateLead(leadAfterSend.id, { aiPaused: false });
              console.log(`[cron] IA reativada para ${fu.phone} após follow-up`);
            }

            const steps = agCfg.followUps ?? [];
            const nextIdx = (fu.stepIndex ?? 0) + 1;
            const nextStep = steps[nextIdx];
            if (nextStep) {
              scheduleFollowUp({
                clientId: fu.clientId,
                phone: fu.phone,
                scheduledAt: new Date(Date.now() + nextStep.delayHours * 3600000).toISOString(),
                message: nextStep.message,
                type: "followup",
                stepIndex: nextIdx,
                stepId: nextStep.id,
                messageType: nextStep.messageType,
                templateId: nextStep.templateId,
                templateVariables: nextStep.templateVariables,
              });
            }
          } catch (e) {
            console.error("[cron] Erro follow-up:", fu.id, e);
          }
        }

        // ── Batches de mensagens vencidos ──────────────────────────────────
        const batches = getDuePending();
        for (const batch of batches) {
          const client = getClientById(batch.clientId);
          if (!client) continue;
          const allCfgs = getAllAgentConfigs(client);
          const agCfg = allCfgs.find(c => c.enabled);
          if (!agCfg) continue;
          try {
            markProcessing(batch.id);
            const combined = batch.messages.join("\n");
            const history = getHistory(batch.phone);
            const connId = agCfg.whatsappConnectionId;
            const { text: reply } = await runGeminiAgent(combined, history, batch.clientId, batch.phone, connId);
            markDone(batch.id);
            if (reply) {
              addMessage(batch.phone, { role: "assistant", content: reply, ts: Date.now() }, batch.clientId);
              await sendMessage(batch.phone, reply, batch.clientId, connId);
            }
          } catch (e) {
            console.error("[cron] Erro batch:", batch.id, e);
            markDone(batch.id);
          }
        }

        if (due.length > 0 || batches.length > 0) {
          console.log(`[cron] follow-ups: ${due.length}, batches: ${batches.length}`);
        }
      } catch (e) {
        console.error("[cron] Erro geral:", e);
      }
    };

    // Aguarda 5s após iniciar (servidor estabilizar) e depois roda a cada 60s
    setTimeout(() => {
      tick();
      setInterval(tick, 60_000);
    }, 5000);

  } catch (e) {
    console.error("[cron] Falha ao iniciar agendador:", e);
  }
}
