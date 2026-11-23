import { getEmployeeById, employeeCanAccessFunnel } from "@/lib/employees";
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getClientById } from "@/lib/clients";
import { getConnectionMetricsForClient } from "@/lib/connection-metrics";

export async function GET() {
  const session = await getSession();
  if (!session || (session.role !== "client" && session.role !== "employee")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const clientId = session.clientId!;
  const client = (await getClientById(clientId));
  if (!client) return NextResponse.json({ error: "Client not found" }, { status: 404 });

  const employee = session.role === "employee" ? await getEmployeeById(session.employeeId!) : undefined;
  const connections = (await getConnectionMetricsForClient(clientId)).filter(connection => !employee || employeeCanAccessFunnel(employee, connection.funnelId)).map(connection => ({ ...connection, qr: undefined }));
  return NextResponse.json({ connections });
}
