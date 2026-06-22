import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getClients } from "@/lib/clients";
import { getSheetsClientFromToken } from "@/lib/google-sheets";

export const dynamic = "force-dynamic";

// Rota administrativa de uso único — corrige as fórmulas da aba "Resumo" da
// planilha do Vítallí Garden, adicionando o filtro de data (células L1/L2)
// às fórmulas de cada categoria (Pernoites, Day Use, Almoço, Festa Junina).
// Usa o acesso OAuth já concedido (googleRefreshToken) salvo no agentConfig
// do cliente — não requer credenciais novas.
export async function GET() {
  const session = await getSession();
  if (!session || session.role !== "manager") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const client = getClients().find((c) => c.name?.toLowerCase().includes("vitalli"));
  if (!client) return NextResponse.json({ error: "Cliente Vítallí não encontrado" }, { status: 404 });

  const allConfigs = [client.agentConfig, ...(client.agentConfigs ?? [])].filter(
    (c): c is NonNullable<typeof c> => !!c
  );
  const cfg = allConfigs.find((c) => c.googleRefreshToken && c.spreadsheetId);
  const refreshToken = cfg?.googleRefreshToken;
  const spreadsheetId = cfg?.spreadsheetId;
  if (!refreshToken || !spreadsheetId) {
    return NextResponse.json({
      error: "Cliente sem googleRefreshToken/spreadsheetId configurado",
      debug: allConfigs.map((c) => ({ name: c.name, hasToken: !!c.googleRefreshToken, hasSheet: !!c.spreadsheetId })),
    }, { status: 400 });
  }

  const sheets = await getSheetsClientFromToken(refreshToken);

  // Definição das categorias: aba, linha-base de início dos dados, colunas de origem.
  const PERNOITE = {
    tab: "Pernoite",
    dataStart: 4,
    dataEnd: 203,
    col: { pessoas: "E", idade05: null, idade612: null, total: "I", pago: "J", falta: "K" },
  };
  const PADRAO = (tab: string) => ({
    tab,
    dataStart: 2,
    dataEnd: 1000,
    col: { pessoas: "H", idade05: "E", idade612: "F", total: "J", pago: "K", falta: "L" },
  });
  const categorias = [
    { row: 4, def: PERNOITE },
    { row: 5, def: PADRAO("Day Use") },
    { row: 6, def: PADRAO("Almoço") },
    { row: 7, def: PADRAO("FESTA JUNINA") },
  ];

  const quote = (tab: string) => (/[^A-Za-z0-9çÇ]/.test(tab) ? `'${tab}'` : tab);

  type Cell = { range: string; values: [[string]] };
  const data: Cell[] = [];

  for (const { row, def } of categorias) {
    const { tab, dataStart, dataEnd, col } = def;
    const t = quote(tab);
    const dateRange = `${t}!B${dataStart}:B${dataEnd}`;
    const dateCriteria = `${dateRange},">="&$L$1,${dateRange},"<="&$L$2`;

    data.push({ range: `Resumo!B${row}`, values: [[`=SUMIFS(${t}!${col.pessoas}${dataStart}:${col.pessoas}${dataEnd},${dateCriteria})`]] });
    if (col.idade05) {
      data.push({ range: `Resumo!C${row}`, values: [[`=SUMIFS(${t}!${col.idade05}${dataStart}:${col.idade05}${dataEnd},${dateCriteria})`]] });
    } else {
      data.push({ range: `Resumo!C${row}`, values: [[""]] });
    }
    if (col.idade612) {
      data.push({ range: `Resumo!D${row}`, values: [[`=SUMIFS(${t}!${col.idade612}${dataStart}:${col.idade612}${dataEnd},${dateCriteria})`]] });
    } else {
      data.push({ range: `Resumo!D${row}`, values: [[""]] });
    }
    data.push({ range: `Resumo!E${row}`, values: [[`=SUMIFS(${t}!${col.total}${dataStart}:${col.total}${dataEnd},${dateCriteria})`]] });
    data.push({ range: `Resumo!F${row}`, values: [[`=SUMIFS(${t}!${col.pago}${dataStart}:${col.pago}${dataEnd},${dateCriteria})`]] });
    data.push({ range: `Resumo!G${row}`, values: [[`=SUMIFS(${t}!${col.falta}${dataStart}:${col.falta}${dataEnd},${dateCriteria})`]] });
    data.push({ range: `Resumo!H${row}`, values: [[`=COUNTIFS(${t}!${col.total}${dataStart}:${col.total}${dataEnd},">0",${dateCriteria})`]] });
  }

  // Linha TOTAL GERAL (linha 8) — soma as 4 categorias acima.
  for (const colLetter of ["B", "C", "D", "E", "F", "G", "H"]) {
    data.push({ range: `Resumo!${colLetter}8`, values: [[`=SUM(${colLetter}4:${colLetter}7)`]] });
  }

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: { valueInputOption: "USER_ENTERED", data },
  });

  return NextResponse.json({ ok: true, cellsUpdated: data.length });
}
