import { getWppSessions } from "./wppconnect-sessions";
import { checkConnectionStatus, startSession } from "./wppconnect-api";
import { getConfig } from "./clients";

/**
 * Cobre o cenário: o servidor WPPConnect (processo separado) cai/reinicia
 * sozinho, sem que o trafegopagoplataforma reinicie junto. Sem isso, a
 * reconexão só era tentada uma vez no boot do Next.js (instrumentation.ts) —
 * e mesmo aí, só re-registrava sessões que JÁ estavam conectadas, nunca
 * tentando de fato retomar uma sessão caída a partir do token salvo.
 *
 * Roda a cada tick do agendador (60s). Não mexe em sessões com status
 * "QRCODE" — evita invalidar um QR que alguém pode estar escaneando na hora.
 * Cooldown por sessão evita martelar o servidor WPPConnect indefinidamente
 * enquanto uma sessão continuar desconectada (ex: logout real no celular,
 * que exige mesmo um QR novo — não adianta tentar de novo a cada minuto).
 */
const RECONNECT_COOLDOWN_MS = 10 * 60 * 1000; // 10 min
const lastAttempt = new Map<string, number>();

export async function reconnectDroppedWppSessions(): Promise<void> {
  const appBaseUrl = getConfig().appBaseUrl?.replace(/\/$/, "");
  if (!appBaseUrl) return;

  const sessions = getWppSessions();
  const now = Date.now();

  for (const wpp of sessions) {
    if (!wpp.funnelId) continue; // sessão nunca vinculada a um funil — ignora

    const last = lastAttempt.get(wpp.id);
    if (last && now - last < RECONNECT_COOLDOWN_MS) continue;

    try {
      const status = await checkConnectionStatus(wpp.sessionName, wpp.sessionToken);
      if (status === "CONNECTED" || status === "QRCODE") continue;

      lastAttempt.set(wpp.id, now);
      console.log(`[wppconnect-health] session=${wpp.sessionName} status=${status} — tentando reconectar automaticamente`);
      const webhookUrl = `${appBaseUrl}/api/whatsapp/webhook/wppconnect/${wpp.id}`;
      await startSession(wpp.sessionName, wpp.sessionToken, webhookUrl);
    } catch (e) {
      console.error(`[wppconnect-health] erro ao tentar reconectar ${wpp.sessionName}:`, e);
    }
  }
}
