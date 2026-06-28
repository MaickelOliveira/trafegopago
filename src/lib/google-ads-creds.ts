import { getConfig } from "./clients";
import type { GoogleAdsCreds } from "./google-ads-api";

/** Resolve as credenciais do Google Ads a partir do AppConfig global.
 *  Retorna null se a conexão ainda não foi configurada/feita. */
export function getGoogleAdsCreds(): GoogleAdsCreds | null {
  const config = getConfig();
  if (!config.googleClientId || !config.googleClientSecret || !config.googleAdsDeveloperToken || !config.googleAdsRefreshToken) {
    return null;
  }
  return {
    clientId: config.googleClientId,
    clientSecret: config.googleClientSecret,
    developerToken: config.googleAdsDeveloperToken,
    refreshToken: config.googleAdsRefreshToken,
    loginCustomerId: config.googleAdsLoginCustomerId,
  };
}
