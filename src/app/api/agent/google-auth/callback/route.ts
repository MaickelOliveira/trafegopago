import { NextRequest, NextResponse } from "next/server";
import { exchangeCode } from "@/lib/google-calendar";
import { getClientById, upsertClient, getConfig } from "@/lib/clients";

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const clientId = req.nextUrl.searchParams.get("state");
  const base = getConfig().appBaseUrl ?? "";

  if (!code || !clientId) {
    return NextResponse.redirect(`${base}/gestor/${clientId ?? ""}/agente?error=oauth_failed`);
  }

  try {
    const refreshToken = await exchangeCode(code, req.nextUrl.origin);
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

    return NextResponse.redirect(`${base}/gestor/${clientId}/agente?calendar=connected`);
  } catch (e) {
    console.error("[google-auth/callback] Error:", e);
    return NextResponse.redirect(`${base}/gestor/${clientId}/agente?error=oauth_failed`);
  }
}
