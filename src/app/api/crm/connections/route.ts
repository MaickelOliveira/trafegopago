import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getLiveConnectionsForClient } from "@/lib/connection-metrics";

// Lista os números de WhatsApp conectados de um cliente (Meta API oficial,
// WPPConnect e UazAPI) — usado pelo seletor "responder pelo número" no CRM.
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const clientId = session.role === "client" || session.role === "employee"
    ? session.clientId
    : req.nextUrl.searchParams.get("clientId");

  if (!clientId) return NextResponse.json({ connections: [] });

  const connections = await getLiveConnectionsForClient(clientId);
  return NextResponse.json({ connections });
}
