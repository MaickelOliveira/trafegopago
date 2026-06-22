// Rastreia quais mídias nomeadas [MIDIA:nome] já foram enviadas em cada conversa,
// para evitar reenvio quando o modelo de IA inclui o mesmo marcador em mais de uma
// resposta (a instrução "envie só uma vez por conversa" no prompt nem sempre é
// respeitada de forma confiável pelo modelo).
const sentMedia = new Map<string, Set<string>>();

function key(clientId: string | null | undefined, connId: string | undefined, phone: string): string {
  return `${clientId ?? ""}:${connId ?? ""}:${phone}`;
}

// Remove da lista os nomes já enviados antes nesta conversa.
export function filterUnsentMedia(
  clientId: string | null | undefined,
  connId: string | undefined,
  phone: string,
  names: string[]
): string[] {
  const k = key(clientId, connId, phone);
  const sent = sentMedia.get(k);
  if (!sent) return names;
  return names.filter((n) => !sent.has(n));
}

// Marca os nomes como já enviados nesta conversa.
export function markMediaSent(
  clientId: string | null | undefined,
  connId: string | undefined,
  phone: string,
  names: string[]
): void {
  if (names.length === 0) return;
  const k = key(clientId, connId, phone);
  const sent = sentMedia.get(k) ?? new Set<string>();
  for (const n of names) sent.add(n);
  sentMedia.set(k, sent);
}
