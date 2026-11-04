import { consumeOAuthState } from "@/lib/oauth-state";
import { NextRequest, NextResponse } from "next/server";
import { exchangeAdsCode } from "@/lib/google-ads-auth";
import { getConfig, saveConfig } from "@/lib/clients";
import { withDataTransaction } from "@/lib/document-store";

async function getPublicBase(req: NextRequest): Promise<string> {
  const config = (await getConfig());
  return (process.env.APP_BASE_URL || config.appBaseUrl || req.nextUrl.origin).replace(/\/$/, "");
}

// GET /api/agent/google-ads-auth/callback — recebe o redirect do Google.
// Diferente do Calendar (per-cliente), aqui o refresh token é salvo no
// AppConfig global — uma conexão só, reaproveitada por todos os clientes.
export async function GET(req: NextRequest) {
  const base = await getPublicBase(req);
  try { await consumeOAuthState("google-ads", req.nextUrl.searchParams.get("state")); }
  catch { return NextResponse.redirect(`${base}/gestor/configuracoes?googleAds=expired`); }
  const code = req.nextUrl.searchParams.get("code");

  if (!code) {
    return NextResponse.redirect(`${base}/gestor/configuracoes?googleAds=error`);
  }

  try {
    const refreshToken = await exchangeAdsCode(code, base);
    await withDataTransaction(async () => {
      const current = await getConfig();
      await saveConfig({ ...current, googleAdsRefreshToken: refreshToken });
    });
    return NextResponse.redirect(`${base}/gestor/configuracoes?googleAds=connected`);
  } catch {
    console.error("[google-ads-auth/callback] Falha ao concluir a autorização.");
    return NextResponse.redirect(`${base}/gestor/configuracoes?googleAds=error`);
  }
}
