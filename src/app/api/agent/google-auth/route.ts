import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getAuthUrl } from "@/lib/google-calendar";
import { getConfig } from "@/lib/clients";

/** Retorna a URL base pública correta mesmo dentro de Docker/EasyPanel */
function getPublicBase(req: NextRequest): string {
  const config = getConfig();
  // 1. Configuração explícita do admin (mais confiável)
  if (config.appBaseUrl) return config.appBaseUrl.replace(/\/$/, "");
  // 2. Headers do reverse proxy (EasyPanel/Traefik)
  const proto = req.headers.get("x-forwarded-proto") ?? "https";
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (host) return `${proto}://${host}`;
  // 3. Fallback (pode ser localhost em Docker)
  return req.nextUrl.origin;
}

// GET /api/agent/google-auth?clientId=xxx[&connId=yyy] — inicia OAuth
// (o callback do Google é tratado em /api/agent/google-auth/callback/route.ts)
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "manager") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const clientId = req.nextUrl.searchParams.get("clientId");
  if (!clientId) return NextResponse.json({ error: "clientId required" }, { status: 400 });

  const connId = req.nextUrl.searchParams.get("connId");
  const baseUrl = getPublicBase(req);
  const url = getAuthUrl(clientId, baseUrl, connId);
  return NextResponse.redirect(url);
}
