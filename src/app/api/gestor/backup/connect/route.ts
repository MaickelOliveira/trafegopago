import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getConfig } from "@/lib/clients";
import { createNexoGoogleOAuthClient, nexoGoogleCredentials } from "@/lib/google-nexo-auth";
import { createOAuthState } from "@/lib/oauth-state";
export async function GET(request: NextRequest) {
  if ((await getSession())?.role !== "manager") return NextResponse.json({ error: "Não autorizado." }, { status: 403 });
  const config = await getConfig();
  let configured = false;
  try { configured = !!nexoGoogleCredentials(config); } catch { /* incomplete pair */ }
  if (!configured) return NextResponse.redirect(new URL("/gestor/configuracoes?backup=setup", request.url));
  const oauth = createNexoGoogleOAuthClient(config, process.env.APP_BASE_URL || config.appBaseUrl || request.nextUrl.origin, "backup");
  return NextResponse.redirect(oauth.generateAuthUrl({ access_type: "offline", prompt: "consent", scope: ["https://www.googleapis.com/auth/drive.file"], state: await createOAuthState("google-backup") }));
}
