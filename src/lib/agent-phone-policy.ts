export type AgentPhonePolicy = {
  ignoredPhones?: readonly string[];
};

/** Mantém somente os dígitos usados pelo WhatsApp e aceita o prefixo
 * internacional 00 como equivalente a +. */
export function normalizeAgentPhone(value: string): string {
  const digits = String(value ?? "").replace(/\D/g, "");
  return digits.startsWith("00") ? digits.slice(2) : digits;
}

export function isValidAgentPhone(value: string): boolean {
  const digits = normalizeAgentPhone(value);
  return digits.length >= 8 && digits.length <= 15;
}

export function splitAgentPhoneInput(value: string): string[] {
  return value
    .split(/[\n,;]+/)
    .map((phone) => phone.trim())
    .filter(Boolean);
}

export function sanitizeAgentPhoneList(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return [...new Set(
    values
      .map((value) => normalizeAgentPhone(String(value)))
      .filter((phone) => isValidAgentPhone(phone)),
  )];
}

function phoneAliases(value: string): string[] {
  const phone = normalizeAgentPhone(value);
  if (!phone) return [];
  const aliases = new Set([phone]);

  // No Brasil, provedores diferentes ainda alternam entre números com e sem
  // o nono dígito. As duas formas precisam representar o mesmo contato.
  if (phone.startsWith("55") && phone.length === 12) {
    aliases.add(`${phone.slice(0, 4)}9${phone.slice(4)}`);
  } else if (phone.startsWith("55") && phone.length === 13 && phone[4] === "9") {
    aliases.add(`${phone.slice(0, 4)}${phone.slice(5)}`);
  } else if (!phone.startsWith("55") && (phone.length === 10 || phone.length === 11)) {
    const withCountry = `55${phone}`;
    aliases.add(withCountry);
    if (withCountry.length === 12) aliases.add(`${withCountry.slice(0, 4)}9${withCountry.slice(4)}`);
    if (withCountry.length === 13 && withCountry[4] === "9") aliases.add(`${withCountry.slice(0, 4)}${withCountry.slice(5)}`);
  }

  return [...aliases];
}

/** Política única de silêncio para todos os provedores. `candidatePhones`
 * pode conter tanto o identificador recebido quanto o telefone real salvo no
 * lead, necessário para contatos LID do WhatsApp. */
export function isAgentPhoneIgnored(
  config: AgentPhonePolicy | null | undefined,
  ...candidatePhones: Array<string | null | undefined>
): boolean {
  const ignored = new Set((config?.ignoredPhones ?? []).flatMap(phoneAliases));
  if (ignored.size === 0) return false;
  return candidatePhones.some((phone) => phoneAliases(phone ?? "").some((alias) => ignored.has(alias)));
}
