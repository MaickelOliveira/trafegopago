import { getConfig } from "./clients";
import type { GoogleAdsCreds } from "./google-ads-api";
import { hasNexoGoogleAdsAuthorization, nexoGoogleCredentials } from "./google-nexo-auth";

/** Resolve as credenciais do Google Ads a partir do AppConfig global.
 *  Retorna null se a conexão ainda não foi configurada/feita. */
export async function getGoogleAdsCreds(): Promise<GoogleAdsCreds | null> {
  const config = (await getConfig());
  if (!hasNexoGoogleAdsAuthorization(config) || !config.googleAdsDeveloperToken) {
    return null;
  }
  const credentials = nexoGoogleCredentials(config)!;
  return {
    ...credentials,
    developerToken: config.googleAdsDeveloperToken,
    refreshToken: config.googleAdsRefreshToken!,
    loginCustomerId: config.googleAdsLoginCustomerId,
  };
}
