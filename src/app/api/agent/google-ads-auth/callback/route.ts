import { NextRequest, NextResponse } from "next/server";
import { exchangeAdsCode } from "@/lib/google-ads-auth";
import { getConfig, saveConfig } from "@/lib/clients";

function getPublicBase(req: NextRequest): string {
  const config = getConfig();
  if (config.appBaseUrl) return config.appBaseUrl.replace(/\/$/, "");
  const proto = req.headers.get("x-forwarded-proto") ?? "https";
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (host) return `${proto}://${host}`;
  return req.nextUrl.origin;
}

// GET /api/agent/google-ads-auth/callback — recebe o redirect do Google.
// Diferente do Calendar (per-cliente), aqui o refresh token é salvo no
// AppConfig global — uma conexão só, reaproveitada por todos os clientes.
export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const base = getPublicBase(req);

  if (!code) {
    return NextResponse.redirect(`${base}/gestor/configuracoes?googleAds=error`);
  }

  try {
    const refreshToken = await exchangeAdsCode(code, base);
    const current = getConfig();
    saveConfig({ ...current, googleAdsRefreshToken: refreshToken });
    return NextResponse.redirect(`${base}/gestor/configuracoes?googleAds=connected`);
  } catch (e) {
    console.error("[google-ads-auth/callback] Error:", e);
    return NextResponse.redirect(`${base}/gestor/configuracoes?googleAds=error`);
  }
}
