import { NextRequest, NextResponse } from "next/server";
import { getConfig, saveConfig } from "@/lib/clients";

/** Retorna a URL pública da plataforma, mesmo atrás de reverse proxy (EasyPanel/nginx) */
function getPublicBaseUrl(req: NextRequest, appBaseUrl?: string): string {
  if (appBaseUrl) return appBaseUrl.replace(/\/$/, "");
  const proto = req.headers.get("x-forwarded-proto") ?? req.nextUrl.protocol.replace(":", "");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? req.nextUrl.host;
  return `${proto}://${host}`;
}

export async function GET(req: NextRequest) {
  const config = getConfig();
  const baseUrl = getPublicBaseUrl(req, config.appBaseUrl);

  const code = req.nextUrl.searchParams.get("code");
  const error = req.nextUrl.searchParams.get("error");

  if (error || !code) {
    return NextResponse.redirect(`${baseUrl}/gestor/configuracoes?meta_error=cancelled`);
  }

  if (!config.metaAppId || !config.metaAppSecret) {
    return NextResponse.redirect(`${baseUrl}/gestor/configuracoes?meta_error=no_app`);
  }

  const redirectUri = `${baseUrl}/api/meta/oauth/callback`;

  // Troca code por token de curta duração
  const tokenRes = await fetch(
    `https://graph.facebook.com/v19.0/oauth/access_token?` +
    new URLSearchParams({
      client_id: config.metaAppId,
      client_secret: config.metaAppSecret,
      redirect_uri: redirectUri,
      code,
    })
  );
  const tokenData = await tokenRes.json();

  if (!tokenData.access_token) {
    return NextResponse.redirect(`${req.nextUrl.origin}/gestor/configuracoes?meta_error=token_failed`);
  }

  // Troca por token de longa duração (60 dias)
  const longRes = await fetch(
    `https://graph.facebook.com/v19.0/oauth/access_token?` +
    new URLSearchParams({
      grant_type: "fb_exchange_token",
      client_id: config.metaAppId,
      client_secret: config.metaAppSecret,
      fb_exchange_token: tokenData.access_token,
    })
  );
  const longData = await longRes.json();
  const finalToken = longData.access_token ?? tokenData.access_token;

  saveConfig({ ...config, metaToken: finalToken });

  return NextResponse.redirect(`${baseUrl}/gestor/configuracoes?meta_success=1`);
}
