import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getLeadById } from "@/lib/leads";
import { cancelFollowUp, getActiveFollowUpsForLead } from "@/lib/followups";
import { withDataTransaction } from "@/lib/document-store";

// DELETE /api/crm/leads/[id]/followups — cancela todos os follow-ups do lead
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session || session.role !== "manager") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const lead = (await getLeadById(id));
  if (!lead) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await withDataTransaction(async()=>{ for(const followUp of await getActiveFollowUpsForLead(lead))await cancelFollowUp(followUp.id); });
  return NextResponse.json({ ok: true });
}

// GET /api/crm/leads/[id]/followups — lista follow-ups pendentes do lead
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const lead = (await getLeadById(id));
  if (!lead) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const pending = await getActiveFollowUpsForLead(lead);
  return NextResponse.json(pending);
}
