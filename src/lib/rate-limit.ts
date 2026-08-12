// Rate limit simples em memória — o app roda como processo Node único
// (`output: "standalone"`, sem funções serverless), então um Map em memória
// do processo é suficiente e não precisa de Redis/banco externo.

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

/** Janela fixa: `key` some do mapa assim que a janela expira. Retorna `true`
 *  se a chamada é permitida (e já conta essa chamada), `false` se estourou o
 *  limite da janela atual. */
export function checkRateLimit(key: string, maxAttempts: number, windowMs: number): boolean {
  const now = Date.now();
  const existing = buckets.get(key);

  if (!existing || existing.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }

  if (existing.count >= maxAttempts) return false;

  existing.count += 1;
  return true;
}

// Limpeza periódica pra não acumular chaves expiradas indefinidamente em
// processos de vida longa.
setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}, 5 * 60 * 1000).unref();
