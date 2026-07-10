/**
 * Registro de mensagens já salvas em conversations pela IA ou pela plataforma.
 * Evita duplicidade quando o WPPConnect dispara onselfmessage de volta para nossas próprias mensagens.
 */
const sentRegistry = new Map<string, string[]>(); // phone → conteúdos recentes

/**
 * Registry de envios recentes da plataforma (janela curta, uso limitado).
 * Impede que ecos onselfmessage/onanymessage de qualquer tipo (texto ou mídia) pausem a IA.
 * O WPPConnect pode disparar 2 eventos para a mesma mensagem (onanymessage + onselfmessage),
 * e o consumeSent remove a entrada no primeiro — o segundo ficaria sem correspondência.
 * A janela cobre esses 2 ecos, mas expira rápido (8s) e tem no máximo 2 usos —
 * assim uma mensagem real do operador logo depois de um envio nosso não é engolida
 * como se fosse eco (era o bug: janela de 30s sem limite de uso escondia o operador
 * assumindo a conversa quando isso acontecia perto de um envio da IA/plataforma).
 */
const phoneSendingRegistry = new Map<string, { expiry: number; usesLeft: number }>();

export function markPhoneSending(phone: string) {
  const expiry = Date.now() + 8_000;
  phoneSendingRegistry.set(phone, { expiry, usesLeft: 2 });
  console.log(`[wppconnect-sent] markPhoneSending phone=${phone} expiry_in=8s usesLeft=2`);
  setTimeout(() => {
    const stored = phoneSendingRegistry.get(phone);
    if (stored && stored.expiry <= Date.now()) phoneSendingRegistry.delete(phone);
  }, 8_000);
}

export function isPhoneSending(phone: string): boolean {
  const entry = phoneSendingRegistry.get(phone);
  if (!entry) return false;
  if (Date.now() >= entry.expiry) {
    phoneSendingRegistry.delete(phone);
    return false;
  }
  entry.usesLeft -= 1;
  if (entry.usesLeft <= 0) phoneSendingRegistry.delete(phone);
  return true;
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
