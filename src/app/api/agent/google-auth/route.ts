import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getAuthUrl, exchangeCode } from "@/lib/google-calendar";
import { getClientById, upsertClient, getConfig } from "@/lib/clients";

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

// GET /api/agent/google-auth/start?clientId=xxx — inicia OAuth
export async function GET(req: NextRequest) {
  const path = req.nextUrl.pathname;

  // Callback do Google
  if (path.endsWith("/callback")) {
    const code = req.nextUrl.searchParams.get("code");
    const clientId = req.nextUrl.searchParams.get("state");

    if (!code || !clientId) {
      return NextResponse.redirect(`${getConfig().appBaseUrl}/gestor/${clientId}/agente?error=oauth_failed`);
    }

    try {
      const refreshToken = await exchangeCode(code);
      const client = getClientById(clientId);
      if (!client) throw new Error("Client not found");

      const current = client.agentConfig ?? { enabled: false, followUpEnabled: false, followUps: [] };
      upsertClient({
        ...client,
        agentConfig: {
          ...current,
          googleRefreshToken: refreshToken,
          googleCalendarId: current.googleCalendarId ?? "primary",
        },
      });

      return NextResponse.redirect(`${getConfig().appBaseUrl}/gestor/${clientId}/agente?calendar=connected`);
    } catch (e) {
      console.error("[google-auth] OAuth error:", e);
      return NextResponse.redirect(`${getConfig().appBaseUrl}/gestor/${clientId}/agente?error=oauth_failed`);
    }
  }

  // Inicia OAuth
  const session = await getSession();
  if (!session || session.role !== "manager") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const clientId = req.nextUrl.searchParams.get("clientId");
  if (!clientId) return NextResponse.json({ error: "clientId required" }, { status: 400 });

  const baseUrl = getPublicBase(req);
  const url = getAuthUrl(clientId, baseUrl);
  return NextResponse.redirect(url);
}
