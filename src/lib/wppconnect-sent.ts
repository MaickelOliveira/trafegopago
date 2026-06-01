/**
 * Registro de mensagens já salvas em conversations pela IA ou pela plataforma.
 * Evita duplicidade quando o WPPConnect dispara onselfmessage de volta para nossas próprias mensagens.
 */
const sentRegistry = new Map<string, string[]>(); // phone → conteúdos recentes

/**
 * Registry de mídias enviadas pela plataforma (janela de 30s).
 * Impede que o eco onselfmessage de áudio/vídeo/documento pause a IA.
 */
const mediaSendingRegistry = new Map<string, number>(); // phone → timestamp de expiração

export function markMediaSending(phone: string) {
  const expiry = Date.now() + 30_000;
  mediaSendingRegistry.set(phone, expiry);
  console.log(`[wppconnect-sent] markMediaSending phone=${phone} expiry=${expiry}`);
  setTimeout(() => {
    const stored = mediaSendingRegistry.get(phone);
    if (stored && stored <= Date.now()) mediaSendingRegistry.delete(phone);
  }, 30_000);
}

export function isMediaSending(phone: string): boolean {
  const expiry = mediaSendingRegistry.get(phone);
  if (!expiry) return false;
  if (Date.now() < expiry) return true;
  mediaSendingRegistry.delete(phone);
  return false;
}

export function markSent(phone: string, content: string) {
  const list = sentRegistry.get(phone) ?? [];
  list.push(content);
  sentRegistry.set(phone, list);
  console.log(`[wppconnect-sent] markSent phone=${phone} content="${content.slice(0, 60)}" registry_size=${list.length}`);
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
  console.log(`[wppconnect-sent] consumeSent phone=${phone} content="${content.slice(0, 60)}" list=${JSON.stringify(list?.map(s => s.slice(0,40)))}`);
  if (!list) return false;
  const idx = list.indexOf(content);
  if (idx === -1) return false;
  list.splice(idx, 1);
  if (list.length === 0) sentRegistry.delete(phone);
  return true;
}
