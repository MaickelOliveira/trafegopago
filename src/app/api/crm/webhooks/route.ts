import { NextRequest, NextResponse } from "next/server";
import { getWebhooks, createWebhook } from "@/lib/webhooks";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const clientId = req.nextUrl.searchParams.get("clientId") ?? undefined;
  return NextResponse.json(getWebhooks(clientId));
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { clientId, funnelId, columnId, name, fieldMapping, active } = body;
  if (!clientId || !funnelId || !columnId || !name) {
    return NextResponse.json({ error: "clientId, funnelId, columnId, name são obrigatórios" }, { status: 400 });
  }
  const wh = createWebhook({
    clientId,
    funnelId,
    columnId,
    name,
    fieldMapping: fieldMapping ?? { nameField: "name", phoneField: "phone" },
    active: active ?? true,
  });
  return NextResponse.json(wh, { status: 201 });
}
