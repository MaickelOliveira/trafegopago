/**
 * Registro de mensagens já salvas em conversations pela IA ou pela plataforma.
 * Evita duplicidade quando o WPPConnect dispara onselfmessage de volta para nossas próprias mensagens.
 */
const sentRegistry = new Map<string, string[]>(); // phone → conteúdos recentes

export function markSent(phone: string, content: string) {
  const list = sentRegistry.get(phone) ?? [];
  list.push(content);
  sentRegistry.set(phone, list);
  // Remove após 60s para não acumular memória
  setTimeout(() => {
    const cur = sentRegistry.get(phone);
    if (!cur) return;
    const idx = cur.indexOf(content);
    if (idx !== -1) cur.splice(idx, 1);
    if (cur.length === 0) sentRegistry.delete(phone);
  }, 60_000);
}

export function consumeSent(phone: string, content: string): boolean {
  const list = sentRegistry.get(phone);
  if (!list) return false;
  const idx = list.indexOf(content);
  if (idx === -1) return false;
  list.splice(idx, 1);
  if (list.length === 0) sentRegistry.delete(phone);
  return true;
}
