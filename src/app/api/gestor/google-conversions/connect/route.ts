import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getConfig } from "@/lib/clients";
import { googleConversionAuthUrl } from "@/lib/google-conversion-auth";
export async function GET(request: NextRequest) {
  if ((await getSession())?.role !== "manager") return NextResponse.json({ error: "Acesso não permitido." }, { status: 403 });
  const clientId = request.nextUrl.searchParams.get("clientId");
  if (!clientId || !/^[a-zA-Z0-9_-]{1,100}$/.test(clientId)) return NextResponse.json({ error: "Cliente inválido." }, { status: 400 });
  const config = await getConfig();
  const base = (process.env.APP_BASE_URL || config.appBaseUrl || request.nextUrl.origin).replace(/\/$/, "");
  try { return NextResponse.redirect(await googleConversionAuthUrl(clientId, base)); }
  catch { return NextResponse.redirect(`${base}/gestor/${encodeURIComponent(clientId)}/configuracoes?secao=conversoes&googleConversions=setup`); }
}
