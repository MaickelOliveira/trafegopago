import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getLeadById, updateLead, deleteLead } from "@/lib/leads";
import { getFunnelById } from "@/lib/funnels";
import { getEmployeeById, employeeCanAccessFunnel } from "@/lib/employees";
import { withDataTransaction } from "@/lib/document-store";

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  const body = await request.json().catch(() => null);
  if (!body || !["delete", "move", "migrate", "ai"].includes(body.action) || !Array.isArray(body.ids) || !body.ids.length || body.ids.length > 500 || body.ids.some((id: unknown) => typeof id !== "string")) {
    return NextResponse.json({ error: "Operação ou lista de contatos inválida." }, { status: 400 });
  }
  const employee = session.role === "employee" ? await getEmployeeById(session.employeeId!) : undefined;
  if (employee && body.action === "delete" && !employee.permissions?.canDeleteLeads) return NextResponse.json({ error: "Sem permissão para apagar contatos." }, { status: 403 });
  if (employee && body.action === "ai" && !employee.permissions?.canManageLeadMessages) return NextResponse.json({ error: "Sem permissão para alterar o atendimento por IA." }, { status: 403 });
  return withDataTransaction(async () => {
    const leads = await Promise.all([...new Set<string>(body.ids)].map(getLeadById));
    if (leads.some(lead => !lead || session.role !== "manager" && lead.clientId !== session.clientId || employee && !employeeCanAccessFunnel(employee, lead!.funnelId))) {
      return NextResponse.json({ error: "Acesso não permitido a um dos contatos." }, { status: 403 });
    }
    const target = body.action === "migrate" && typeof body.funnelId === "string" ? await getFunnelById(body.funnelId) : undefined;
    if (body.action === "migrate" && (!target || leads.some(lead => lead!.clientId !== target.clientId) || employee && !employeeCanAccessFunnel(employee, target.id))) return NextResponse.json({ error: "Funil de destino inválido." }, { status: 400 });
    const columnId = body.colId ?? target?.columns[0]?.id;
    for (const lead of leads) {
      const funnel = target ?? await getFunnelById(lead!.funnelId);
      if (["move", "migrate"].includes(body.action) && (!funnel || !funnel.columns.some(column => column.id === columnId))) return NextResponse.json({ error: "Etapa de destino inválida." }, { status: 400 });
    }
    if (body.action === "ai" && typeof body.aiPaused !== "boolean") return NextResponse.json({ error: "Estado da IA inválido." }, { status: 400 });
    let count = 0;
    for (const lead of leads) {
      if (body.action === "delete") { if (await deleteLead(lead!.id)) count++; }
      else if (await updateLead(lead!.id, body.action === "ai" ? { aiPaused: body.aiPaused } : { status: columnId, ...(target ? { funnelId: target.id } : {}) })) count++;
    }
    const key = body.action === "delete" ? "deleted" : body.action === "move" ? "moved" : body.action === "migrate" ? "migrated" : "updated";
    return NextResponse.json({ ok: true, [key]: count });
  });
}
