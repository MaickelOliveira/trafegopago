/**
 * Chaves da API Gemini (Google AI Studio) começam com "AIza" e têm 39 caracteres.
 * Qualquer outro valor (ex.: senha preenchida pelo autocompletar do navegador) é ignorado
 * para não sobrescrever uma chave válida já salva.
 */
const GEMINI_KEY_PATTERN = /^AIza[0-9A-Za-z_-]{30,}$/;

export function isGeminiApiKey(value: unknown): value is string {
  return typeof value === "string" && GEMINI_KEY_PATTERN.test(value.trim());
}

/** Devolve a chave nova só se ela parecer uma chave Gemini válida; senão mantém a atual. */
export function resolveGeminiApiKeyUpdate(incoming: unknown, current: string | undefined): string | undefined {
  return isGeminiApiKey(incoming) ? incoming.trim() : current;
}
