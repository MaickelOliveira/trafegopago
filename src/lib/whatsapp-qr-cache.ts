// Cache em memória do QR recebido via webhook "qrcode" do WPPConnect.
// Esse evento dispara em tempo real a cada regeneração do QR pelo WhatsApp
// (~15-20s) — usado como fonte primária para evitar o cache server-side do
// endpoint qrcode-session, que às vezes trava num QR antigo até um restart.

type CachedQr = { qr: string; urlcode: string; ts: number };

const QR_CACHE_TTL_MS = 90_000;

const qrCache = new Map<string, CachedQr>();

export function setCachedQr(sessionName: string, qrDataUri: string, urlcode: string): void {
  qrCache.set(sessionName, { qr: qrDataUri, urlcode, ts: Date.now() });
}

export function getCachedQr(sessionName: string): string | null {
  const entry = qrCache.get(sessionName);
  if (!entry) return null;
  if (Date.now() - entry.ts > QR_CACHE_TTL_MS) return null;
  return entry.qr;
}

// Invalida o cache ao reiniciar/encerrar a sessão — evita mostrar um QR
// da sessão anterior até o próximo evento "qrcode" chegar.
export function clearCachedQr(sessionName: string): void {
  qrCache.delete(sessionName);
}
