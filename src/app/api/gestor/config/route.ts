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
    metaAppId: config.metaAppId ?? "",
    metaAppSecret: config.metaAppSecret ?? "",
    anthropicApiKey: config.anthropicApiKey ?? "",
    uazapiServer: config.uazapiServer ?? "",
    uazapiToken: config.uazapiToken ?? "",
    uazapiAdminToken: config.uazapiAdminToken ?? "",
    appBaseUrl: config.appBaseUrl ?? "",
    uazapiWebhookForward: config.uazapiWebhookForward ?? "",
    geminiApiKey: config.geminiApiKey ?? "",
    googleClientId: config.googleClientId ?? "",
    googleClientSecret: config.googleClientSecret ?? "",
    agentCronSecret: config.agentCronSecret ?? "",
    masterPhone: config.masterPhone ?? "",
    masterConnectionId: config.masterConnectionId ?? "",
    masterMetaTemplateBriefing: config.masterMetaTemplateBriefing ?? "",
    masterMetaLanguage: config.masterMetaLanguage ?? "pt_BR",
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
    metaAppId: body.metaAppId ?? current.metaAppId,
    metaAppSecret: body.metaAppSecret ?? current.metaAppSecret,
    anthropicApiKey: body.anthropicApiKey ?? current.anthropicApiKey,
    uazapiServer: body.uazapiServer ?? current.uazapiServer,
    uazapiToken: body.uazapiToken ?? current.uazapiToken,
    uazapiAdminToken: body.uazapiAdminToken ?? current.uazapiAdminToken,
    appBaseUrl: body.appBaseUrl ?? current.appBaseUrl,
    uazapiWebhookForward: body.uazapiWebhookForward ?? current.uazapiWebhookForward,
    geminiApiKey: body.geminiApiKey ?? current.geminiApiKey,
    googleClientId: body.googleClientId ?? current.googleClientId,
    googleClientSecret: body.googleClientSecret ?? current.googleClientSecret,
    agentCronSecret: body.agentCronSecret ?? current.agentCronSecret,
    masterPhone: body.masterPhone ?? current.masterPhone,
    masterConnectionId: body.masterConnectionId ?? current.masterConnectionId,
    masterMetaTemplateBriefing: body.masterMetaTemplateBriefing ?? current.masterMetaTemplateBriefing,
    masterMetaLanguage: body.masterMetaLanguage ?? current.masterMetaLanguage,
  });
  return NextResponse.json({ ok: true });
}
