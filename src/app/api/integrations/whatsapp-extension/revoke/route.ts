import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { revokeDevice, revokeDeviceAsManager } from "@/lib/extension-devices";
import { recordAuditEvent } from "@/lib/extension-audit-log";

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || (session.role !== "client" && session.role !== "employee" && session.role !== "manager")) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const body = await req.json().catch(() => null) as { deviceId?: string } | null;
  if (!body?.deviceId) {
    return NextResponse.json({ error: "deviceId obrigatório" }, { status: 400 });
  }

  if (session.role === "manager") {
    // Gestor já tem acesso irrestrito a todas as organizações em todas as
    // outras telas administrativas (ex: evolution-manager) — sem exigir clientId aqui.
    const ok = revokeDeviceAsManager(body.deviceId);
    if (!ok) return NextResponse.json({ error: "Dispositivo não encontrado" }, { status: 404 });
    recordAuditEvent({ event: "device_revoked", deviceId: body.deviceId });
    return NextResponse.json({ ok: true });
  }

  if (!session.clientId) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  if (session.role === "employee") {
    const { getEmployeeById } = await import("@/lib/employees");
    const emp = session.employeeId ? getEmployeeById(session.employeeId) : null;
    if (!emp || !emp.active || !emp.permissions?.canManageQR) {
      return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
    }
  }

  // revokeDevice já escopa por clientId — um usuário não consegue revogar
  // dispositivo de outra organização mesmo sabendo o id.
  const ok = revokeDevice(body.deviceId, session.clientId);
  if (!ok) return NextResponse.json({ error: "Dispositivo não encontrado" }, { status: 404 });

  recordAuditEvent({ event: "device_revoked", clientId: session.clientId, deviceId: body.deviceId });
  return NextResponse.json({ ok: true });
}
