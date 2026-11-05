export async function startBackgroundJobs() {
  if (process.env.NEXT_RUNTIME === "edge" || process.env.TP_BACKGROUND_JOBS_ENABLED === "false") return;

  try {
    const { processDueFollowUpsAndBatches } = await import("./lib/cron-tasks");

    console.log("[cron] Agendador interno iniciado — verificação a cada 60s");

    // Processamento de follow-ups e batches — lógica unificada em cron-tasks.ts
    // (compartilhada com a rota HTTP /api/agent/cron) para evitar duas
    // implementações divergentes competindo pelos mesmos itens.
    const tick = async () => {
      try {
        const result = await processDueFollowUpsAndBatches();
        if (result.total > 0 || result.batchesProcessed > 0 || result.crmJobsProcessed > 0 || result.crmJobsFailed > 0 || result.dailySummariesSent > 0 || result.aiAutoResumed > 0) {
          console.log(`[cron] follow-ups: processed=${result.processed} skipped=${result.skipped} total=${result.total} batches=${result.batchesProcessed} crmJobs=${result.crmJobsProcessed} crmJobsFailed=${result.crmJobsFailed} dailySummaries=${result.dailySummariesSent} aiAutoResumed=${result.aiAutoResumed}`);
        }
      } catch (e) {
        console.error("[cron] Erro geral:", e);
      }
      try {
        const { runDailyBackupIfDue, runDailyMediaBackupIfDue } = await import("./lib/backup-scheduler");
        void runDailyBackupIfDue()
          .then(runDailyMediaBackupIfDue)
          .catch(() => console.error("[backup] O backup diário precisa de atenção."));
      } catch {
        console.error("[backup] O backup diário precisa de atenção. Consulte a configuração e o histórico.");
      }
      // Independent outbox: conversion delivery never holds up AI processing.
      try {
        const { processGoogleConversionOutbox } = await import("./lib/google-conversion-outbox");
        void processGoogleConversionOutbox().catch(() => console.error("[google-conversions] A fila de conversões precisa de atenção."));
      } catch { console.error("[google-conversions] Não foi possível verificar a fila de conversões."); }
    };

    // Aguarda 5s após iniciar (servidor estabilizar) e depois roda a cada 60s
    setTimeout(async () => {
      (await tick());
      setInterval(tick, 60_000);
    }, 5000);

    // Tick dedicado para disparos em massa (broadcasts.ts/broadcast-items.ts)
    // — intervalo próprio de 5s, independente do tick de 60s acima, para
    // conseguir espaçar envios pelo delay configurável na campanha (ex: 10s
    // entre mensagens) sem competir por tempo com follow-ups/batches/kanban.
    // Mesmo racional já documentado em crm-automation-jobs.ts para não usar
    // setTimeout por item: sobrevive a restart do processo.
    const broadcastTick = async () => {
      try {
        const { processDueBroadcastItems } = await import("./lib/broadcast-items");
        const { processed } = await processDueBroadcastItems();
        if (processed > 0) console.log(`[cron] broadcasts: processed=${processed}`);
      } catch (e) {
        console.error("[cron] Erro no tick de broadcasts:", e);
      }
    };
    setTimeout(async () => {
      (await broadcastTick());
      setInterval(broadcastTick, 5_000);
    }, 5000);

  } catch (e) {
    console.error("[cron] Falha ao iniciar agendador:", e);
  }
}
