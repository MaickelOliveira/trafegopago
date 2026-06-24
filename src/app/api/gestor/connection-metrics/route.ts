import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getClientById } from "@/lib/clients";
import { getConnectionMetricsForClient, getCachedAllClientsMetrics } from "@/lib/connection-metrics";

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "manager") {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }

  const clientId = req.nextUrl.searchParams.get("clientId");
  if (clientId) {
    const client = getClientById(clientId);
    if (!client) return NextResponse.json({ error: "Client not found" }, { status: 404 });
    const connections = await getConnectionMetricsForClient(clientId);
    return NextResponse.json({ connections });
  }

  const clients = await getCachedAllClientsMetrics();
  return NextResponse.json({ clients });
}
