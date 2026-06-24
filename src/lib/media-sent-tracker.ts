// Rastreia quais mídias nomeadas [MIDIA:nome] já foram enviadas em cada conversa,
// para evitar reenvio quando o modelo de IA inclui o mesmo marcador em mais de uma
// resposta (a instrução "envie só uma vez por conversa" no prompt nem sempre é
// respeitada de forma confiável pelo modelo).
//
// A supressão vale só por uma janela de tempo curta — o objetivo é evitar o modelo
// floodar a mesma foto duas vezes em respostas seguidas, não bloquear pra sempre.
// Sem expiração, um cliente que pede a mesma foto de novo horas depois (reenvio
// legítimo, explicitamente solicitado) nunca recebia nada.
const RESEND_WINDOW_MS = 15 * 60 * 1000; // 15 minutos

const sentMedia = new Map<string, Map<string, number>>();

function key(clientId: string | null | undefined, connId: string | undefined, phone: string): string {
  return `${clientId ?? ""}:${connId ?? ""}:${phone}`;
}

// Remove da lista os nomes enviados há menos de RESEND_WINDOW_MS nesta conversa.
export function filterUnsentMedia(
  clientId: string | null | undefined,
  connId: string | undefined,
  phone: string,
  names: string[]
): string[] {
  const k = key(clientId, connId, phone);
  const sent = sentMedia.get(k);
  if (!sent) return names;
  const now = Date.now();
  return names.filter((n) => {
    const sentAt = sent.get(n);
    return sentAt === undefined || now - sentAt > RESEND_WINDOW_MS;
  });
}

// Marca os nomes como enviados agora nesta conversa.
export function markMediaSent(
  clientId: string | null | undefined,
  connId: string | undefined,
  phone: string,
  names: string[]
): void {
  if (names.length === 0) return;
  const k = key(clientId, connId, phone);
  const sent = sentMedia.get(k) ?? new Map<string, number>();
  const now = Date.now();
  for (const n of names) sent.set(n, now);
  sentMedia.set(k, sent);
}
