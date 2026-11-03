import type { AppConfig } from "./clients";
export const secretConfigKeys = ["metaToken", "metaAppSecret", "anthropicApiKey", "geminiApiKey", "evolutionAdminKey", "googleClientSecret", "googleAdsDeveloperToken", "agentCronSecret"] as const;
export const visibleConfigKeys = ["metaAppId", "evolutionServer", "appBaseUrl", "googleClientId", "googleAdsLoginCustomerId", "masterPhone", "masterConnectionId", "masterMetaTemplateBriefing", "masterMetaLanguage"] as const;
type SecretKey = typeof secretConfigKeys[number];
type ConfigKey = SecretKey | typeof visibleConfigKeys[number];
export function safePlatformConfig(config: AppConfig): Record<ConfigKey, string> & { configuredSecrets: Record<SecretKey, boolean>; googleAdsConnected: boolean } {
  const fields = Object.fromEntries([...visibleConfigKeys.map(key => [key, config[key] ?? ""]), ...secretConfigKeys.map(key => [key, ""])]) as Record<ConfigKey, string>;
  return { ...fields, configuredSecrets: Object.fromEntries(secretConfigKeys.map(key => [key, !!config[key]])) as Record<SecretKey, boolean>, googleAdsConnected: !!config.googleAdsRefreshToken };
}
export function platformConfigPatch(body: unknown): Partial<AppConfig> {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw Error("Configuração inválida.");
  const input = body as Record<string, unknown>; const patch: Record<string, string> = {};
  for (const key of [...visibleConfigKeys, ...secretConfigKeys]) {
    if (!(key in input)) continue;
    const value = input[key];
    if (typeof value !== "string" || value.length > 4096) throw Error("Configuração inválida.");
    // An empty password-style field preserves the stored credential.
    if (secretConfigKeys.includes(key as typeof secretConfigKeys[number]) && !value.trim()) continue;
    if (["evolutionServer", "appBaseUrl"].includes(key) && value) { const url = new URL(value); if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) throw Error("Endereço de serviço inválido."); }
    patch[key] = value.trim();
  }
  return patch;
}
