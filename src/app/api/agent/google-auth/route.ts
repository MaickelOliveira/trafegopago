import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getAuthUrl, exchangeCode } from "@/lib/google-calendar";
import { getClientById, upsertClient, getConfig } from "@/lib/clients";

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

  const url = getAuthUrl(clientId);
  return NextResponse.redirect(url);
}
