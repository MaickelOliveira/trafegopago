import { NextRequest, NextResponse } from "next/server";
import { getClientById, getConfig, saveConfig } from "./clients";
import { createNexoGoogleOAuthClient, nexoGoogleCredentials } from "./google-nexo-auth";
import { createOAuthState, consumeOAuthState } from "./oauth-state";
import { withDataTransaction } from "./document-store";

export const DATA_MANAGER_SCOPE = "https://www.googleapis.com/auth/datamanager";
export const CONVERSION_STATE_PREFIX = "conversions.";
export function hasGoogleConversionAuthorization(config: Awaited<ReturnType<typeof getConfig>>): boolean {
  try { return !!config.googleConversionsRefreshToken && !!nexoGoogleCredentials(config) && config.googleConversionsOAuthClientId === config.nexoGoogleClientId; } catch { return false; }
}
export async function googleConversionAuthUrl(clientId: string, base: string) {
  if (!await getClientById(clientId)) throw Error("Cliente indisponível.");
  const config = await getConfig();
  // Reuse the registered Nexo redirect, with a separate signed state and token.
  return createNexoGoogleOAuthClient(config, base, "ads").generateAuthUrl({ access_type: "offline", prompt: "consent", scope: [DATA_MANAGER_SCOPE], state: CONVERSION_STATE_PREFIX + await createOAuthState("google-conversions", { clientId }) });
}
export async function completeGoogleConversionAuthorization(request: NextRequest) {
  const config = await getConfig();
  const base = (process.env.APP_BASE_URL || config.appBaseUrl || request.nextUrl.origin).replace(/\/$/, "");
  let destination = `${base}/gestor/configuracoes`;
  let stage = "state";
  try {
    const state = request.nextUrl.searchParams.get("state");
    if (!state?.startsWith(CONVERSION_STATE_PREFIX)) throw Error("Invalid purpose");
    const details = await consumeOAuthState("google-conversions", state.slice(CONVERSION_STATE_PREFIX.length));
    stage = "client";
    if (!details.clientId || !await getClientById(details.clientId)) throw Error("Invalid client");
    destination = `${base}/gestor/${encodeURIComponent(details.clientId)}/configuracoes?secao=conversoes`;
    stage = "exchange";
    const code = request.nextUrl.searchParams.get("code");
    const credentials = nexoGoogleCredentials(config);
    if (!code || !credentials) throw Error("Consent not completed");
    const { tokens } = await createNexoGoogleOAuthClient(config, base, "ads").getToken(code);
    stage = "scope";
    if (!tokens.refresh_token || !tokens.scope?.split(" ").includes(DATA_MANAGER_SCOPE)) throw Error("Permission not granted");
    stage = "save";
    await withDataTransaction(async () => {
      const current = await getConfig();
      const pair = nexoGoogleCredentials(current);
      if (pair?.clientId !== credentials.clientId || pair.clientSecret !== credentials.clientSecret) throw Error("Application changed");
      await saveConfig({ ...current, googleConversionsRefreshToken: tokens.refresh_token!, googleConversionsOAuthClientId: credentials.clientId });
    });
    return NextResponse.redirect(`${destination}${destination.includes("?") ? "&" : "?"}googleConversions=connected`);
  } catch {
    // Stage only: never log the authorization code, token, signed state or provider response.
    console.warn(`[google-conversions] OAuth callback failed at ${stage}`);
    return NextResponse.redirect(`${destination}${destination.includes("?") ? "&" : "?"}googleConversions=error`);
  }
}
