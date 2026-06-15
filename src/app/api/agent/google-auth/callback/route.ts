import { NextRequest, NextResponse } from "next/server";
import { exchangeCode } from "@/lib/google-calendar";
import { getClientById, getAgentConfigForConnection, upsertAgentConfigForConnection, getConfig } from "@/lib/clients";

function getPublicBase(req: NextRequest): string {
  const config = getConfig();
  if (config.appBaseUrl) return config.appBaseUrl.replace(/\/$/, "");
  const proto = req.headers.get("x-forwarded-proto") ?? "https";
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (host) return `${proto}://${host}`;
  return req.nextUrl.origin;
}

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const stateRaw = req.nextUrl.searchParams.get("state");
  const base = getPublicBase(req);

  let clientId: string | null = null;
  let connId: string | null = null;
  if (stateRaw) {
    try {
      const parsed = JSON.parse(stateRaw) as { clientId?: string; connId?: string | null };
      clientId = parsed.clientId ?? null;
      connId = parsed.connId ?? null;
    } catch {
      clientId = stateRaw; // compat com state antigo (apenas o clientId puro)
    }
  }

  if (!code || !clientId) {
    return NextResponse.redirect(`${base}/gestor/${clientId ?? ""}/agente?error=oauth_failed`);
  }

  try {
    const refreshToken = await exchangeCode(code, base);
    const client = getClientById(clientId);
    if (!client) throw new Error("Client not found");

    const current = getAgentConfigForConnection(client, connId) ?? { enabled: false, followUpEnabled: false, followUps: [] };
    upsertAgentConfigForConnection(client, connId, {
      ...current,
      googleRefreshToken: refreshToken,
      googleCalendarId: current.googleCalendarId ?? "primary",
    });

    const connParam = connId ? `&connId=${encodeURIComponent(connId)}` : "";
    return NextResponse.redirect(`${base}/gestor/${clientId}/agente?calendar=connected${connParam}`);
  } catch (e) {
    console.error("[google-auth/callback] Error:", e);
    return NextResponse.redirect(`${base}/gestor/${clientId}/agente?error=oauth_failed`);
  }
}
