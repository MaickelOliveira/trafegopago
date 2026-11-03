import { createOAuthState } from "./oauth-state";
import { auth } from "googleapis/build/src/apis/calendar/index.js";
import { getConfig } from "./clients";

// Arquivo separado do google-calendar.ts: mesmo Client ID/Secret OAuth, mas
// escopo e redirect URI diferentes, e o refresh token resultante vai pro
// AppConfig global (conexão única pra agência toda) em vez de por cliente.

export async function getAdsOAuth2Client(baseUrl?: string) {
  const config = (await getConfig());
  const clientId = process.env.GOOGLE_CLIENT_ID || config.googleClientId;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET || config.googleClientSecret;
  const base = baseUrl || config.appBaseUrl || "";
  const redirectUri = `${base}/api/agent/google-ads-auth/callback`;
  return new auth.OAuth2(clientId, clientSecret, redirectUri);
}

export async function getAdsAuthUrl(baseUrl?: string): Promise<string> {
  const oauth2 = (await getAdsOAuth2Client(baseUrl));
  return oauth2.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: ["https://www.googleapis.com/auth/adwords"],
    state: await createOAuthState("google-ads"),
  });
}

export async function exchangeAdsCode(code: string, baseUrl?: string): Promise<string> {
  const oauth2 = (await getAdsOAuth2Client(baseUrl));
  const { tokens } = await oauth2.getToken(code);
  if (!tokens.refresh_token) throw new Error("No refresh token received");
  return tokens.refresh_token;
}
