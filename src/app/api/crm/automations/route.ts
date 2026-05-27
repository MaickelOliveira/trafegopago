import { NextRequest, NextResponse } from "next/server";
import { getAutomations, createAutomation } from "@/lib/crm-automations";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const clientId = req.nextUrl.searchParams.get("clientId") ?? undefined;
  return NextResponse.json(getAutomations(clientId));
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const {
    clientId, name, trigger,
    funnelId, triggerColumnId, triggerWebhookId, scheduledTime,
    steps,
    // legacy fields (mantidos para retrocompatibilidade)
    channel, connectionId, message, templateId, templateVariables, delayMinutes,
    active,
  } = body;

  if (!clientId || !name || !trigger) {
    return NextResponse.json({ error: "clientId, name e trigger são obrigatórios" }, { status: 400 });
  }

  const auto = createAutomation({
    clientId,
    name,
    trigger,
    funnelId: funnelId || undefined,
    triggerColumnId: triggerColumnId || undefined,
    triggerWebhookId: triggerWebhookId || undefined,
    scheduledTime: scheduledTime || undefined,
    steps: steps ?? undefined,
    // legacy
    channel: channel || undefined,
    connectionId: connectionId || undefined,
    message: message || undefined,
    templateId: templateId || undefined,
    templateVariables: templateVariables || undefined,
    delayMinutes: delayMinutes ?? undefined,
    active: active ?? true,
  });

  return NextResponse.json(auto, { status: 201 });
}
