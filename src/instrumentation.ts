export async function register() {
  if (process.env.NEXT_RUNTIME === "edge") return;

  try {
    const { processDueFollowUpsAndBatches } = await import("./lib/cron-tasks");
    const { getConfig } = await import("./lib/clients");

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

    // Processamento de follow-ups e batches — lógica unificada em cron-tasks.ts
    // (compartilhada com a rota HTTP /api/agent/cron) para evitar duas
    // implementações divergentes competindo pelos mesmos itens.
    const tick = async () => {
      try {
        const result = await processDueFollowUpsAndBatches();
        if (result.total > 0 || result.batchesProcessed > 0) {
          console.log(`[cron] follow-ups: processed=${result.processed} skipped=${result.skipped} total=${result.total} batches=${result.batchesProcessed}`);
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
