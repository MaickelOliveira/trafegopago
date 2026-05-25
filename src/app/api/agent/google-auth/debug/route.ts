import { NextRequest, NextResponse } from "next/server";
import { getConfig } from "@/lib/clients";

/** Rota temporária de debug — mostra o redirect URI que será enviado ao Google */
export async function GET(req: NextRequest) {
  const config = getConfig();
  const proto = req.headers.get("x-forwarded-proto") ?? "https";
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  const fromHeaders = host ? `${proto}://${host}` : null;
  const appBaseUrl = config.appBaseUrl || null;
  const reqOrigin = req.nextUrl.origin;

  const base = appBaseUrl ?? fromHeaders ?? reqOrigin;
  const redirectUri = `${base}/api/agent/google-auth/callback`;

  return NextResponse.json({
    redirectUri,
    clientId: config.googleClientId ? config.googleClientId.slice(0, 20) + "..." : "(não configurado)",
    sources: {
      appBaseUrl,
      fromForwardedHeaders: fromHeaders,
      reqOrigin,
    },
  });
}
