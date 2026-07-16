// Cache em memória do QR recebido via webhook "QRCODE_UPDATED" da Evolution API.
// Esse evento dispara em tempo real a cada regeneração do QR pelo WhatsApp
// (~15-20s) — usado como fonte primária para evitar o cache server-side do
// endpoint connect/{instance}, que às vezes trava num QR antigo até um restart.
// Cache separado do wppconnect-qr.ts para não colidir chaves entre providers.

type CachedQr = { qr: string; urlcode: string; ts: number };

const QR_CACHE_TTL_MS = 90_000;

const qrCache = new Map<string, CachedQr>();

export function setCachedQr(instanceName: string, qrDataUri: string, urlcode: string): void {
  qrCache.set(instanceName, { qr: qrDataUri, urlcode, ts: Date.now() });
}

export function getCachedQr(instanceName: string): string | null {
  const entry = qrCache.get(instanceName);
  if (!entry) return null;
  if (Date.now() - entry.ts > QR_CACHE_TTL_MS) return null;
  return entry.qr;
}

// Invalida o cache ao reiniciar/encerrar a instância — evita mostrar um QR
// da sessão anterior até o próximo evento "QRCODE_UPDATED" chegar.
export function clearCachedQr(instanceName: string): void {
  qrCache.delete(instanceName);
}
