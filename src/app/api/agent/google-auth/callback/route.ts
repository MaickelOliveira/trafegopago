import { decodeJwt } from "jose";
import { completeDriveBackupAuthorization } from "@/lib/drive-backup-auth";
import { consumeOAuthState } from "@/lib/oauth-state";
import { NextRequest, NextResponse } from "next/server";
import { exchangeCode } from "@/lib/google-calendar";
import { getClientById, getAgentConfigForConnection, upsertAgentConfigForConnection, getConfig } from "@/lib/clients";

async function getPublicBase(req: NextRequest): Promise<string> {
  const config = (await getConfig());
  if (config.appBaseUrl) return config.appBaseUrl.replace(/\/$/, "");
  const proto = req.headers.get("x-forwarded-proto") ?? "https";
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (host) return `${proto}://${host}`;
  return req.nextUrl.origin;
}

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const stateRaw = req.nextUrl.searchParams.get("state");
  try { if (stateRaw && decodeJwt(stateRaw).provider === "google-backup") return await completeDriveBackupAuthorization(req); } catch { return NextResponse.json({ error: "Autorização inválida." }, { status: 403 }); }
  const base = (await getPublicBase(req));

  let clientId: string | undefined;
  let connId: string | null | undefined;
  try { ({ clientId, connId } = await consumeOAuthState("google-calendar", stateRaw)); }
  catch { return NextResponse.json({ error: "Autorização expirada ou inválida. Inicie a conexão novamente." }, { status: 403 }); }

  if (!code || !clientId) {
    return NextResponse.redirect(`${base}/gestor/${clientId ?? ""}/agente?error=oauth_failed`);
  }

  try {
    const refreshToken = await exchangeCode(code, base);
    const client = (await getClientById(clientId));
    if (!client) throw new Error("Client not found");

    const current = getAgentConfigForConnection(client, connId) ?? { enabled: false, followUpEnabled: false, followUps: [] };
    (await upsertAgentConfigForConnection(client, connId, {
      ...current,
      googleRefreshToken: refreshToken,
      googleCalendarId: current.googleCalendarId ?? "primary",
    }));

    const connParam = connId ? `&connId=${encodeURIComponent(connId)}` : "";
    return NextResponse.redirect(`${base}/gestor/${clientId}/agente?calendar=connected${connParam}`);
  } catch (e) {
    console.error("[google-auth/callback] Error:", e);
    return NextResponse.redirect(`${base}/gestor/${clientId}/agente?error=oauth_failed`);
  }
}
