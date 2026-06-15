import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getClientById, getAgentConfigForConnection } from "@/lib/clients";
import { listSpreadsheets } from "@/lib/google-sheets";

// GET /api/agent/spreadsheets?clientId=xxx[&connId=yyy] — lista as planilhas do Google Drive do cliente
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "manager") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const clientId = req.nextUrl.searchParams.get("clientId");
  if (!clientId) return NextResponse.json({ error: "clientId required" }, { status: 400 });

  const client = getClientById(clientId);
  if (!client) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const connId = req.nextUrl.searchParams.get("connId");
  const refreshToken = getAgentConfigForConnection(client, connId)?.googleRefreshToken;
  if (!refreshToken) {
    return NextResponse.json({ error: "Google não conectado" }, { status: 400 });
  }

  try {
    const spreadsheets = await listSpreadsheets(refreshToken);
    return NextResponse.json({ spreadsheets });
  } catch (e) {
    console.error("[spreadsheets] error:", e);
    return NextResponse.json({ error: "Erro ao listar planilhas — pode ser necessário reconectar o Google com permissão de Sheets/Drive" }, { status: 500 });
  }
}
