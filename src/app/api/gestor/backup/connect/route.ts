import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getConfig } from "@/lib/clients";
import { getOAuth2Client } from "@/lib/google-calendar";
import { createOAuthState } from "@/lib/oauth-state";
export async function GET(request: NextRequest) {
  if ((await getSession())?.role !== "manager") return NextResponse.json({ error: "Não autorizado." }, { status: 403 });
  const config = await getConfig();
  if (!(process.env.GOOGLE_CLIENT_ID || config.googleClientId) || !(process.env.GOOGLE_CLIENT_SECRET || config.googleClientSecret)) return NextResponse.redirect(new URL("/gestor/configuracoes?backup=setup", request.url));
  const oauth = await getOAuth2Client(process.env.APP_BASE_URL || config.appBaseUrl || request.nextUrl.origin);
  return NextResponse.redirect(oauth.generateAuthUrl({ access_type: "offline", prompt: "consent", scope: ["https://www.googleapis.com/auth/drive.file"], state: await createOAuthState("google-backup") }));
}
