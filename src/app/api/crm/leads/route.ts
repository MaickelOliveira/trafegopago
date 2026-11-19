import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getLeads, attachLeadsHeat, upsertLeadByPhone, type LeadSource } from "@/lib/leads";
import { runAutomationsForEvent } from "@/lib/crm-automations";

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Clientes só podem ver seus próprios leads
  const clientId = session.role !== "manager"
    ? session.clientId
    : (req.nextUrl.searchParams.get("clientId") ?? undefined);
  let leads = (await getLeads(clientId));
  if (session.role === "employee") {
    const { getEmployeeById, employeeCanAccessFunnel } = await import("@/lib/employees");
    const employee = await getEmployeeById(session.employeeId!);
    leads = employee ? leads.filter(lead => employeeCanAccessFunnel(employee, lead.funnelId)) : [];
  }
  return NextResponse.json((await attachLeadsHeat(leads)));
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || (session.role !== "manager" && session.role !== "client" && session.role !== "employee")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const { clientId, name, phone, email, source, campaignName, utmSource, utmCampaign, value, notes } = body;

  if (!clientId || !phone) {
    return NextResponse.json({ error: "clientId e phone são obrigatórios" }, { status: 400 });
  }

  // Clientes e funcionários só podem criar leads para o seu próprio clientId
  if (session.role !== "manager" && session.clientId !== clientId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const lead = (await upsertLeadByPhone(clientId, phone, {
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
  }));

  // Dispara automações CRM (fire-and-forget)
  (await runAutomationsForEvent("lead_created", lead));
  (await runAutomationsForEvent("column_entered", lead, { toColumnId: lead.status }));

  return NextResponse.json(lead, { status: 201 });
}
