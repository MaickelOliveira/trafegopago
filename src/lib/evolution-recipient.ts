/** Keep the sender's WhatsApp address intact while adding a missing BR country code. */
export function evolutionRecipientNumber(
  phone: string,
  isLid: boolean,
  skipNormalize: boolean,
  normalizeBrPhone: (phone: string) => string,
): string {
  if (phone.endsWith("@g.us")) return phone;
  const digits = phone.replace(/@.*$/, "").replace(/\D/g, "");
  if (isLid) return `${digits}@lid`;
  if (!skipNormalize) return normalizeBrPhone(phone);
  // Webhooks can deliver a Brazilian mobile JID without 55 after a re-pair.
  // Preserve its exact local digits: adding/removing the ninth digit here can
  // silently route a response to a different WhatsApp identity.
  return /^[1-9]{2}9\d{8}$/.test(digits) ? `55${digits}` : digits;
}

/** The echoed outbound event may use either the original JID or the dialable one. */
export function evolutionRecipientKeys(original: string, recipient: string): string[] {
  return [...new Set([original, recipient].map(value => value.replace(/@.*$/, "").replace(/\D/g, "")))];
}
