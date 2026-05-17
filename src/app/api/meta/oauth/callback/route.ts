import { NextRequest, NextResponse } from "next/server";
import { getConfig, saveConfig } from "@/lib/clients";

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const error = req.nextUrl.searchParams.get("error");

  if (error || !code) {
    return NextResponse.redirect(`${req.nextUrl.origin}/gestor/configuracoes?meta_error=cancelled`);
  }

  const config = getConfig();
  if (!config.metaAppId || !config.metaAppSecret) {
    return NextResponse.redirect(`${req.nextUrl.origin}/gestor/configuracoes?meta_error=no_app`);
  }

  const redirectUri = `${config.appBaseUrl?.replace(/\/$/, "")}/api/meta/oauth/callback`;

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

  return NextResponse.redirect(`${req.nextUrl.origin}/gestor/configuracoes?meta_success=1`);
}
