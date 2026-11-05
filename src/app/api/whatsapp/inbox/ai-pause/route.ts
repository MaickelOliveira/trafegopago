import { getFunnelForConnection, getLeadForConnection } from "@/lib/lead-context";
import { NextRequest, NextResponse } from "next/server";
import { setAiPaused } from "@/lib/conversations";
import { updateLead } from "@/lib/leads";
import { cancelFollowUpsForPhone } from "@/lib/followups";
import { getSession } from "@/lib/auth";
import { getEmployeeById, employeeCanAccessFunnel } from "@/lib/employees";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const { phone, clientId, paused, connId } = body ?? {};

  if (typeof phone !== "string" || typeof clientId !== "string" || typeof connId !== "string" || typeof paused !== "boolean") {
    return NextResponse.json({ error: "Informe o cliente, o número e a conversa." }, { status: 400 });
  }
  const cleanPhone = phone.replace(/\D/g, "");
  if (!clientId.trim() || !connId.trim() || cleanPhone.length < 8 || cleanPhone.length > 20) {
    return NextResponse.json({ error: "Conversa inválida." }, { status: 400 });
  }
  const session = await getSession();
  if (!session || !["manager", "client", "employee"].includes(session.role) || session.role !== "manager" && session.clientId !== clientId) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 403 });
  }
  const funnel = await getFunnelForConnection(clientId, connId);
  if (!funnel) return NextResponse.json({ error: "Conversa não pertence a este cliente." }, { status: 403 });
  if (session.role === "employee") {
    const employee = session.employeeId ? await getEmployeeById(session.employeeId) : undefined;
    if (!employee || !employee.permissions?.canManageLeadMessages || !employeeCanAccessFunnel(employee, funnel.id)) {
      return NextResponse.json({ error: "Sem permissão para alterar esta conversa." }, { status: 403 });
    }
  }
  // Atualiza os dois storages em sincronia
  (await setAiPaused(cleanPhone, paused, clientId, connId));
  const existingLead = (await getLeadForConnection(clientId, cleanPhone, connId));
  if (existingLead) (await updateLead(existingLead.id, { aiPaused: paused }));
  // A paused chat must not receive a previously scheduled follow-up.
  if (paused) (await cancelFollowUpsForPhone(clientId, cleanPhone, connId));

  return NextResponse.json({ ok: true, aiPaused: paused });
}
