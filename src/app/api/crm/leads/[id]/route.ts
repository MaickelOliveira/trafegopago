import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getLeadById, updateLead, deleteLead } from "@/lib/leads";
import { getFunnelById } from "@/lib/funnels";
import { getClientById } from "@/lib/clients";
import { sendCapiEvent } from "@/lib/meta-capi";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const lead = getLeadById(id);
  if (!lead) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(lead);
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || session.role !== "manager") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const body = await req.json();

  const previous = getLeadById(id);
  const lead = updateLead(id, body);
  if (!lead) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Dispara evento CAPI quando o status muda e a coluna tem metaEvent configurado
  if (body.status && previous && body.status !== previous.status) {
    const funnel = getFunnelById(lead.funnelId);
    const col = funnel?.columns.find((c) => c.id === body.status);
    if (col?.metaEvent) {
      const client = getClientById(lead.clientId);
      if (client?.pixelId) {
        sendCapiEvent({
          pixelId: client.pixelId,
          eventName: col.metaEvent,
          phone: lead.phone,
          email: lead.email ?? undefined,
          externalId: lead.id,
          value: lead.value ?? undefined,
        }).catch((e) => console.error("[Meta CAPI]", e));
      }
    }
  }

  return NextResponse.json(lead);
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || session.role !== "manager") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const ok = deleteLead(id);
  if (!ok) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
