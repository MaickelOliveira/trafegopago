/**
 * Registro de mensagens já salvas em conversations pela IA ou pela plataforma.
 * Evita duplicidade quando o WPPConnect dispara onselfmessage de volta para nossas próprias mensagens.
 */
const sentRegistry = new Map<string, string[]>(); // phone → conteúdos recentes

/**
 * Registry de envios recentes da plataforma (janela de 30s).
 * Impede que ecos onselfmessage/onanymessage de qualquer tipo (texto ou mídia) pausem a IA.
 * O WPPConnect pode disparar 2 eventos para a mesma mensagem (onanymessage + onselfmessage),
 * e o consumeSent remove a entrada no primeiro — o segundo ficaria sem correspondência.
 * A janela de tempo cobre ambos os eventos sem depender de match exato.
 */
const phoneSendingRegistry = new Map<string, number>(); // corePhone → timestamp de expiração

// Usa os últimos 8 dígitos como chave — invariante ao 9º dígito brasileiro.
// O WPPConnect pode entregar o echo com chatId de 12 dígitos (sem o 9) enquanto
// o sendText normalizou o número para 13 dígitos (com o 9). Os 8 finais são iguais.
function corePhone(phone: string): string {
  return phone.replace(/\D/g, "").slice(-8);
}

export function markPhoneSending(phone: string) {
  const key = corePhone(phone);
  const expiry = Date.now() + 30_000;
  phoneSendingRegistry.set(key, expiry);
  console.log(`[wppconnect-sent] markPhoneSending phone=${phone} core=${key} expiry_in=30s`);
  setTimeout(() => {
    const stored = phoneSendingRegistry.get(key);
    if (stored && stored <= Date.now()) phoneSendingRegistry.delete(key);
  }, 30_000);
}

export function isPhoneSending(phone: string): boolean {
  const key = corePhone(phone);
  const expiry = phoneSendingRegistry.get(key);
  if (!expiry) return false;
  if (Date.now() < expiry) return true;
  phoneSendingRegistry.delete(key);
  return false;
}

/** @deprecated use markPhoneSending */
export const markMediaSending = markPhoneSending;
/** @deprecated use isPhoneSending */
export const isMediaSending = isPhoneSending;

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
