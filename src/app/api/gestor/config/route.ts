import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getConfig, saveConfig } from "@/lib/clients";

export async function GET() {
  const session = await getSession();
  if (!session || session.role !== "manager") {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }
  const config = getConfig();
  // never expose password hash
  return NextResponse.json({
    metaToken: config.metaToken ?? "",
    anthropicApiKey: config.anthropicApiKey ?? "",
    uazapiServer: config.uazapiServer ?? "",
    uazapiToken: config.uazapiToken ?? "",
    appBaseUrl: config.appBaseUrl ?? "",
    uazapiWebhookForward: config.uazapiWebhookForward ?? "",
  });
}

export async function PUT(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "manager") {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }
  const body = await req.json();
  const current = getConfig();
  saveConfig({
    ...current,
    metaToken: body.metaToken ?? current.metaToken,
    anthropicApiKey: body.anthropicApiKey ?? current.anthropicApiKey,
    uazapiServer: body.uazapiServer ?? current.uazapiServer,
    uazapiToken: body.uazapiToken ?? current.uazapiToken,
    appBaseUrl: body.appBaseUrl ?? current.appBaseUrl,
    uazapiWebhookForward: body.uazapiWebhookForward ?? current.uazapiWebhookForward,
  });
  return NextResponse.json({ ok: true });
}
