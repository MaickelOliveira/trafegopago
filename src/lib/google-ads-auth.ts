import { createOAuthState } from "./oauth-state";
import { getConfig } from "./clients";
import { createNexoGoogleOAuthClient, nexoGoogleCredentials } from "./google-nexo-auth";

// Ads usa o aplicativo próprio da Nexo. As agendas mantêm suas credenciais.

export async function getAdsOAuth2Client(baseUrl?: string) {
  const config = (await getConfig());
  const base = baseUrl || config.appBaseUrl || "";
  return createNexoGoogleOAuthClient(config, base, "ads");
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

export async function exchangeAdsCode(code: string, baseUrl?: string): Promise<{ refreshToken: string; clientId: string }> {
  const config = await getConfig();
  const credentials = nexoGoogleCredentials(config);
  if (!credentials) throw Error("Aplicativo Google da Nexo não configurado.");
  const oauth2 = createNexoGoogleOAuthClient(config, baseUrl || config.appBaseUrl || "", "ads");
  const { tokens } = await oauth2.getToken(code);
  if (!tokens.refresh_token) throw new Error("No refresh token received");
  return { refreshToken: tokens.refresh_token, clientId: credentials.clientId };
}
