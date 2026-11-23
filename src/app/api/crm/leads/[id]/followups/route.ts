import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getLeadById } from "@/lib/leads";
import { cancelFollowUp, getActiveFollowUpsForLead, getRecentFollowUpsForLead } from "@/lib/followups";
import { withDataTransaction } from "@/lib/document-store";

// DELETE /api/crm/leads/[id]/followups — cancela todos os follow-ups do lead
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session || !["manager", "client", "employee"].includes(session.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const lead = (await getLeadById(id));
  if (!lead) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (session.role !== "manager" && session.clientId !== lead.clientId) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await withDataTransaction(async()=>{ for(const followUp of await getActiveFollowUpsForLead(lead))await cancelFollowUp(followUp.id, "manual"); });
  return NextResponse.json({ ok: true });
}

// GET /api/crm/leads/[id]/followups — próximos envios e histórico recente do lead
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const lead = (await getLeadById(id));
  if (!lead) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (session.role !== "manager" && session.clientId !== lead.clientId) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const pending = await getActiveFollowUpsForLead(lead);
  const recent = await getRecentFollowUpsForLead(lead);
  return NextResponse.json({ pending, recent });
}
