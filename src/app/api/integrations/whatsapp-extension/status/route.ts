import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getDevicesForClient, computeDisplayState } from "@/lib/extension-devices";
import type { DeviceStatusView } from "@/lib/extension-types";

export async function GET() {
  const session = await getSession();
  if (!session || (session.role !== "client" && session.role !== "employee") || !session.clientId) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }
  if (session.role === "employee") {
    const { getEmployeeById } = await import("@/lib/employees");
    const emp = session.employeeId ? getEmployeeById(session.employeeId) : null;
    if (!emp || !emp.active || !emp.permissions?.canManageQR) {
      return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
    }
  }

  const devices = getDevicesForClient(session.clientId).filter((d) => d.status === "active");
  const view: DeviceStatusView[] = devices.map((d) => ({
    id: d.id,
    devicePublicId: d.devicePublicId,
    connectorState: computeDisplayState(d),
    lastSeenAt: d.lastSeenAt,
    createdAt: d.createdAt,
  }));

  return NextResponse.json({ devices: view });
}
