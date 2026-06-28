import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getAdsAuthUrl } from "@/lib/google-ads-auth";
import { getConfig } from "@/lib/clients";

/** Retorna a URL base pública correta mesmo dentro de Docker/EasyPanel */
function getPublicBase(req: NextRequest): string {
  const config = getConfig();
  if (config.appBaseUrl) return config.appBaseUrl.replace(/\/$/, "");
  const proto = req.headers.get("x-forwarded-proto") ?? "https";
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (host) return `${proto}://${host}`;
  return req.nextUrl.origin;
}

// GET /api/agent/google-ads-auth — inicia OAuth do Google Ads (conexão única
// pra agência toda; sem clientId/connId, diferente do fluxo do Calendar).
// O callback é tratado em /api/agent/google-ads-auth/callback/route.ts
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "manager") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const baseUrl = getPublicBase(req);
  return NextResponse.redirect(getAdsAuthUrl(baseUrl));
}
