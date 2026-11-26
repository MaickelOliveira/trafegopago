// Lê um fbc pronto (cookie _fbc do site): fb.<índice>.<ms do clique>.<fbclid>[.<sufixo>].
// Devolve fbclid + momento do clique para o meta-capi remontar o mesmo fbc.
export function parseFbc(value: unknown): { fbclid: string; clickTimeMs: number } | null {
  if (typeof value !== "string") return null;
  const match = /^fb\.\d{1,2}\.(\d{13})\.([\w-]{1,500}(?:\.[\w-]{1,20})?)$/.exec(value.trim());
  if (!match) return null;
  const clickTimeMs = Number(match[1]);
  const now = Date.now();
  if (clickTimeMs > now + 60_000 || clickTimeMs < now - 90 * 86_400_000) return null;
  return { fbclid: match[2], clickTimeMs };
}
