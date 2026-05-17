import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getConfig } from "@/lib/clients";

export async function GET() {
  const session = await getSession();
  if (!session || session.role !== "manager") {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }

  const config = getConfig();
  if (!config.metaAppId || !config.metaAppSecret) {
    return NextResponse.json({ error: "Configure o App ID e App Secret da Meta primeiro." }, { status: 400 });
  }

  const baseUrl = config.appBaseUrl?.replace(/\/$/, "") ?? "";
  const redirectUri = `${baseUrl}/api/meta/oauth/callback`;

  const params = new URLSearchParams({
    client_id: config.metaAppId,
    redirect_uri: redirectUri,
    scope: "ads_read,ads_management,business_management",
    response_type: "code",
  });

  return NextResponse.redirect(`https://www.facebook.com/v19.0/dialog/oauth?${params}`);
}
