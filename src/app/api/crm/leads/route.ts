import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getLeads, upsertLeadByPhone, type LeadSource } from "@/lib/leads";
import { runAutomationsForEvent } from "@/lib/crm-automations";

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Clientes só podem ver seus próprios leads
  const clientId = session.role === "client"
    ? session.clientId
    : (req.nextUrl.searchParams.get("clientId") ?? undefined);
  const leads = getLeads(clientId);
  return NextResponse.json(leads);
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "manager") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const { clientId, name, phone, email, source, campaignName, utmSource, utmCampaign, value, notes } = body;

  if (!clientId || !phone) {
    return NextResponse.json({ error: "clientId e phone são obrigatórios" }, { status: 400 });
  }

  const lead = upsertLeadByPhone(clientId, phone, {
    funnelId: body.funnelId || "default",
    name: name || "Sem nome",
    email: email || null,
    source: (source as LeadSource) || "manual",
    campaignName: campaignName || null,
    utmSource: utmSource || null,
    utmMedium: body.utmMedium || null,
    utmCampaign: utmCampaign || null,
    utmContent: body.utmContent || null,
    utmTerm: body.utmTerm || null,
    fbclid: body.fbclid || null,
    gclid: body.gclid || null,
    value: value ? Number(value) : null,
    status: body.status || "novo",
    notes: notes || "",
    ai: null,
  });

  // Dispara automações CRM (fire-and-forget)
  runAutomationsForEvent("lead_created", lead);
  runAutomationsForEvent("column_entered", lead, { toColumnId: lead.status });

  return NextResponse.json(lead, { status: 201 });
}
