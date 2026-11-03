import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getLeadById, updateLead, deleteLead } from "@/lib/leads";
import { getFunnelById } from "@/lib/funnels";
import { getClientById } from "@/lib/clients";
import { sendCapiEvent } from "@/lib/meta-capi";
import { runAutomationsForEvent } from "@/lib/crm-automations";
import { setAiPaused } from "@/lib/conversations";
import { cancelFollowUpsForPhone } from "@/lib/followups";

// Colunas finais: ao entrar nelas, todos os follow-ups do lead são cancelados
const TERMINAL_COLUMN_IDS = ["ganho", "perdido"];

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const lead = (await getLeadById(id));
  if (!lead) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (session.role !== "manager" && session.clientId !== lead.clientId) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(lead);
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || (session.role !== "manager" && session.role !== "client" && session.role !== "employee")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const body = await req.json();

  const previous = (await getLeadById(id));
  if (!previous || session.role !== "manager" && session.clientId !== previous.clientId) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const allowed = new Set(["name", "phone", "email", "status", "value", "notes", "aiPaused", "followUpDisabled", "realPhone", "customFields", "reminders", "needsAttention"]);
  for (const key of Object.keys(body)) if (!allowed.has(key)) delete body[key];
  if (body.status !== undefined) {
    const funnel = await getFunnelById(previous.funnelId);
    if (typeof body.status !== "string" || !funnel?.columns.some(column => column.id === body.status)) return NextResponse.json({ error: "Etapa inválida." }, { status: 400 });
  }
  if (body.value !== undefined && body.value !== null && (typeof body.value !== "number" || !Number.isFinite(body.value) || body.value < 0)) return NextResponse.json({ error: "Valor inválido." }, { status: 400 });
  for (const field of ["name", "phone", "notes", "realPhone"]) if (body[field] !== undefined && (typeof body[field] !== "string" || body[field].length > (field === "notes" ? 10000 : 250))) return NextResponse.json({ error: "Dados inválidos." }, { status: 400 });
  for (const field of ["aiPaused", "followUpDisabled", "needsAttention"]) if (body[field] !== undefined && typeof body[field] !== "boolean") return NextResponse.json({ error: "Dados inválidos." }, { status: 400 });

  // Limpa o sinal de "precisa de atenção" quando um humano assume a conversa
  // (aiPaused=true) ou o lead é fechado (coluna final) — ambos já indicam que
  // alguém agiu, então some do painel de urgência do cliente.
  const patch = { ...body };
  if (body.aiPaused === true || (body.status && TERMINAL_COLUMN_IDS.includes(body.status))) {
    patch.needsAttention = false;
  }

  const lead = (await updateLead(id, patch));
  if (!lead) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Dispara evento CAPI quando o status muda e a coluna tem metaEvent configurado
  if (body.status && previous && body.status !== previous.status) {
    const funnel = (await getFunnelById(lead.funnelId));
    const col = funnel?.columns.find((c) => c.id === body.status);
    if (col?.metaEvent) {
      const client = (await getClientById(lead.clientId));
      if (client?.pixelId) {
        sendCapiEvent({
          pixelId: client.pixelId,
          capiToken: client.capiToken, // Token de Conversão da API por cliente
          testEventCode: client.capiTestEventCode || undefined,
          eventName: col.metaEvent,
          phone: lead.phone,
          email: lead.email ?? undefined,
          name: lead.name,
          fbclid: lead.fbclid ?? undefined,
          fbp: lead.fbp ?? undefined,
          clientIp: lead.clientIp ?? undefined,
          clientUserAgent: lead.clientUserAgent ?? undefined,
          externalId: lead.id,
          value: lead.value ?? undefined,
        }).catch((e) => console.error("[Meta CAPI]", e));
      }
    }

    // Dispara automações CRM de column_changed e column_entered (fire-and-forget)
    (await runAutomationsForEvent("column_changed", lead, { toColumnId: body.status }));
    (await runAutomationsForEvent("column_entered", lead, { toColumnId: body.status }));
  }

  return NextResponse.json(lead);
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Funcionários só podem apagar se tiverem permissão canDeleteLeads
  if (session.role === "employee") {
    const { getEmployeeById } = await import("@/lib/employees");
    const emp = session.employeeId ? (await getEmployeeById(session.employeeId)) : null;
    if (!emp || !emp.active || !emp.permissions?.canDeleteLeads) {
      return NextResponse.json({ error: "Sem permissão para apagar leads" }, { status: 403 });
    }
  } else if (session.role !== "manager" && session.role !== "client") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const existing = await getLeadById(id);
  if (!existing || session.role !== "manager" && session.clientId !== existing.clientId) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const ok = (await deleteLead(id));
  if (!ok) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
