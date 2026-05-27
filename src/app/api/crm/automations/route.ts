import { NextRequest, NextResponse } from "next/server";
import { getAutomations, createAutomation } from "@/lib/crm-automations";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const clientId = req.nextUrl.searchParams.get("clientId") ?? undefined;
  return NextResponse.json(getAutomations(clientId));
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { clientId, name, trigger, channel, connectionId, funnelId, triggerColumnId,
          message, templateId, templateVariables, delayMinutes, active } = body;

  if (!clientId || !name || !trigger || !channel || !connectionId) {
    return NextResponse.json({ error: "clientId, name, trigger, channel, connectionId são obrigatórios" }, { status: 400 });
  }
  if (channel === "uazapi" && !message) {
    return NextResponse.json({ error: "message é obrigatório para canal uazapi" }, { status: 400 });
  }
  if (channel === "waba" && !templateId) {
    return NextResponse.json({ error: "templateId é obrigatório para canal waba" }, { status: 400 });
  }

  const auto = createAutomation({
    clientId,
    name,
    trigger,
    channel,
    connectionId,
    funnelId: funnelId || undefined,
    triggerColumnId: triggerColumnId || undefined,
    message: message || undefined,
    templateId: templateId || undefined,
    templateVariables: templateVariables || undefined,
    delayMinutes: delayMinutes ?? 0,
    active: active ?? true,
  });

  return NextResponse.json(auto, { status: 201 });
}
