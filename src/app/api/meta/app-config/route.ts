import { NextResponse } from "next/server";

// Retorna configurações públicas da Meta (lidas em runtime, não no build)
export async function GET() {
  const appId = process.env.META_APP_ID ?? process.env.NEXT_PUBLIC_META_APP_ID ?? "";
  const configId = process.env.META_EMBEDDED_CONFIG_ID ?? process.env.NEXT_PUBLIC_META_EMBEDDED_CONFIG_ID ?? "";
  return NextResponse.json({ appId, configId });
}
