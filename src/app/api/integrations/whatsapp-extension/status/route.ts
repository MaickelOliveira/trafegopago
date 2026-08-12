import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getDevicesForClient, getAllDevices, computeDisplayState } from "@/lib/extension-devices";
import { getClients } from "@/lib/clients";
import type { DeviceStatusView } from "@/lib/extension-types";

export async function GET() {
  const session = await getSession();
  if (!session || (session.role !== "client" && session.role !== "employee" && session.role !== "manager")) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  if (session.role === "manager") {
    const clients = getClients();
    const clientNameById = new Map(clients.map((c) => [c.id, c.name]));
    const devices = getAllDevices().filter((d) => d.status === "active");
    const view: DeviceStatusView[] = devices.map((d) => ({
      id: d.id,
      devicePublicId: d.devicePublicId,
      connectorState: computeDisplayState(d),
      lastSeenAt: d.lastSeenAt,
      createdAt: d.createdAt,
      clientId: d.clientId,
      clientName: clientNameById.get(d.clientId) ?? "(cliente não encontrado)",
    }));
    return NextResponse.json({ devices: view });
  }

  if (!session.clientId) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
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
