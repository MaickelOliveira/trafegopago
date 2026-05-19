// Baileys roda como serviço separado (wa-service.js na porta 3002)
export async function register() {
  if (process.env.NEXT_RUNTIME === "edge") return;

  try {
    const { getDueFollowUps, markSent, scheduleFollowUp } = await import("./lib/followups");
    const { getDuePending, markProcessing, markDone } = await import("./lib/pending-responses");
    const { sendMessage } = await import("./lib/whatsapp-send");
    const { runGeminiAgent } = await import("./lib/gemini-agent");
    const { addMessage, getHistory } = await import("./lib/conversations");
    const { getClientById } = await import("./lib/clients");

    console.log("[cron] Agendador interno iniciado — verificação a cada 60s");

    const tick = async () => {
      try {
        // ── Follow-ups vencidos ────────────────────────────────────────────
        const due = getDueFollowUps();
        for (const fu of due) {
          const client = getClientById(fu.clientId);
          if (client?.agentConfig?.followUpEnabled !== true) continue;
          try {
            await sendMessage(fu.phone, fu.message, fu.clientId, client.agentConfig.whatsappConnectionId);
            markSent(fu.id);
            const steps = client.agentConfig.followUps ?? [];
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
          if (!client?.agentConfig?.enabled) continue;
          try {
            markProcessing(batch.id);
            const combined = batch.messages.join("\n");
            const history = getHistory(batch.phone);
            const { text: reply } = await runGeminiAgent(combined, history, batch.clientId, batch.phone);
            markDone(batch.id);
            if (reply) {
              addMessage(batch.phone, { role: "assistant", content: reply, ts: Date.now() }, batch.clientId);
              await sendMessage(batch.phone, reply, batch.clientId, client.agentConfig.whatsappConnectionId);
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
