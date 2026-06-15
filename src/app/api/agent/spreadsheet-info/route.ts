import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getClientById, getAgentConfigForConnection } from "@/lib/clients";
import { getSpreadsheetInfo, getSheetHeaders, extractSpreadsheetId } from "@/lib/google-sheets";

// GET /api/agent/spreadsheet-info?clientId=xxx[&connId=yyy]&spreadsheetId=zzz[&sheetName=Página1]
// Retorna título + abas da planilha (e cabeçalho da aba, se sheetName for informado).
// spreadsheetId aceita tanto o ID puro quanto o link completo do Google Sheets.
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "manager") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const clientId = req.nextUrl.searchParams.get("clientId");
  const rawSpreadsheetId = req.nextUrl.searchParams.get("spreadsheetId");
  if (!clientId) return NextResponse.json({ error: "clientId required" }, { status: 400 });
  if (!rawSpreadsheetId) return NextResponse.json({ error: "spreadsheetId required" }, { status: 400 });

  const client = getClientById(clientId);
  if (!client) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const connId = req.nextUrl.searchParams.get("connId");
  const refreshToken = getAgentConfigForConnection(client, connId)?.googleRefreshToken;
  if (!refreshToken) {
    return NextResponse.json({ error: "Google não conectado" }, { status: 400 });
  }

  const spreadsheetId = extractSpreadsheetId(rawSpreadsheetId);

  try {
    const info = await getSpreadsheetInfo(refreshToken, spreadsheetId);
    const sheetName = req.nextUrl.searchParams.get("sheetName");
    const headers = sheetName ? await getSheetHeaders(refreshToken, spreadsheetId, sheetName) : undefined;
    return NextResponse.json({ spreadsheetId, title: info.title, tabs: info.tabs, headers });
  } catch (e) {
    console.error("[spreadsheet-info] error:", e);
    return NextResponse.json({ error: "Não foi possível acessar essa planilha. Verifique o link/ID e se o Google está conectado com permissão de Sheets." }, { status: 500 });
  }
}
