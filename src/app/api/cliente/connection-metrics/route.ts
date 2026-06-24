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
  const client = getClientById(clientId);
  if (!client) return NextResponse.json({ error: "Client not found" }, { status: 404 });

  const connections = await getConnectionMetricsForClient(clientId);
  return NextResponse.json({ connections });
}
