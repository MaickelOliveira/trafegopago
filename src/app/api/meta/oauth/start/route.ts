import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getConfig } from "@/lib/clients";

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "manager") {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }

  const config = getConfig();
  if (!config.metaAppId || !config.metaAppSecret) {
    return NextResponse.json({ error: "Configure o App ID e App Secret da Meta primeiro." }, { status: 400 });
  }

  // Usa appBaseUrl salvo ou origin da requisição como fallback
  const baseUrl = (config.appBaseUrl?.replace(/\/$/, "")) || req.nextUrl.origin;
  const redirectUri = `${baseUrl}/api/meta/oauth/callback`;

  const params = new URLSearchParams({
    client_id: config.metaAppId,
    redirect_uri: redirectUri,
    scope: "ads_read,ads_management,business_management",
    response_type: "code",
  });

  return NextResponse.redirect(`https://www.facebook.com/v19.0/dialog/oauth?${params}`);
}
