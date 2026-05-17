import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getLeads, createLead, type LeadSource } from "@/lib/leads";

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

  const lead = createLead({
    clientId,
    funnelId: body.funnelId || "default",
    name: name || "Sem nome",
    phone,
    email: email || null,
    source: (source as LeadSource) || "manual",
    campaignName: campaignName || null,
    utmSource: utmSource || null,
    utmCampaign: utmCampaign || null,
    value: value ? Number(value) : null,
    status: body.status || "novo",
    notes: notes || "",
    ai: null,
  });

  return NextResponse.json(lead, { status: 201 });
}
