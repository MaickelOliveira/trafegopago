import { auth } from "googleapis/build/src/apis/calendar/index.js";
import type { AppConfig } from "./clients";

type NexoGoogleConfig = Pick<AppConfig, "nexoGoogleClientId" | "nexoGoogleClientSecret" | "googleAdsRefreshToken" | "googleAdsOAuthClientId">;

/** Never fall back to the credentials used by existing calendars or another system. */
export function nexoGoogleCredentials(config: NexoGoogleConfig): { clientId: string; clientSecret: string } | null {
  const clientId = config.nexoGoogleClientId?.trim();
  const clientSecret = config.nexoGoogleClientSecret?.trim();
  if (!clientId && !clientSecret) return null;
  if (!clientId || !clientSecret) throw Error("Configure o identificador e a chave do aplicativo Google da Nexo.");
  return { clientId, clientSecret };
}

export function createNexoGoogleOAuthClient(config: NexoGoogleConfig, baseUrl: string, purpose: "ads" | "backup") {
  const credentials = nexoGoogleCredentials(config);
  if (!credentials) throw Error("Configure o aplicativo Google da Nexo.");
  const callback = purpose === "ads" ? "google-ads-auth" : "google-auth";
  return new auth.OAuth2(credentials.clientId, credentials.clientSecret, `${baseUrl.replace(/\/$/, "")}/api/agent/${callback}/callback`);
}

export function hasNexoGoogleAdsAuthorization(config: NexoGoogleConfig): boolean {
  try {
    const credentials = nexoGoogleCredentials(config);
    return !!credentials && !!config.googleAdsRefreshToken && config.googleAdsOAuthClientId === credentials.clientId;
  } catch { return false; }
}
