import { getEmployeeById, employeeCanAccessFunnel, DEFAULT_PERMISSIONS } from "@/lib/employees";
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getClientById } from "@/lib/clients";
import { getLiveConnectionsForClient } from "@/lib/connection-metrics";
import QRCode from "qrcode";

export async function GET() {
  const session = await getSession();
  if (!session || (session.role !== "client" && session.role !== "employee")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const clientId = session.clientId!;
  const client = (await getClientById(clientId));
  if (!client) return NextResponse.json({ error: "Client not found" }, { status: 404 });

  const employee = session.role === "employee" ? await getEmployeeById(session.employeeId!) : undefined;
  const connections = (await getLiveConnectionsForClient(clientId)).filter(connection => !employee || employeeCanAccessFunnel(employee, connection.funnelId));

  // Renderiza o QR cru (texto) como imagem PNG base64 — só essa rota precisa disso (pareamento)
  const results = await Promise.all(
    connections.map(async ({ qr, ...conn }) => {
      if (!qr || employee && !(employee.permissions?.canManageQR ?? DEFAULT_PERMISSIONS.canManageQR)) return { ...conn, qr: null as string | null };
      try {
        const qrImage = qr.startsWith("data:") ? qr : await QRCode.toDataURL(qr, { margin: 1, width: 280 });
        return { ...conn, qr: qrImage };
      } catch {
        return { ...conn, qr: null as string | null };
      }
    })
  );

  return NextResponse.json({ connections: results });
}
