import { NextResponse } from "next/server";
import { getClients, getAllAgentConfigs } from "@/lib/clients";
import { getSheetsClientFromToken } from "@/lib/google-sheets";

// GET /api/admin/fix-vitalli-sheets?spreadsheetId=134GWABpZk8QfSskbPy_htJfmTQyx-XroWqXg4JPGt3I
//
// Para as abas Day Use, FESTA JUNINA e Almoço:
// 1. Insere coluna "Pessoas" após "Responsável" (col D)
// 2. Insere coluna "Cidade" após "Status" (col L, após o shift)
// 3. Adiciona dropdown de validação em Status: Pago | Parcial | Pendente
// 4. Corrige dados da linha 2 de cada aba
//
// Endpoint temporário — remover após execução única.

const TABS = ["Day Use", "FESTA JUNINA", "Almoço"];

// null = não tocar; "" = nova célula vazia; "texto" = escrever esse valor
// Índices após as duas inserções: A(0)=Nº B(1)=Data C(2)=Responsável D(3)=Pessoas
// E(4)=Telefone F(5)=Qtd.Pessoas G(6)=Valor/Pessoa H(7)=Valor Total
// I(8)=Valor Pago J(9)=Falta Pagar K(10)=Status L(11)=Cidade M(12)=Observações
const ROW2_FIXES: Record<string, (string | null)[]> = {
  "Day Use":
    [null, null, null, "", null, null, null, null, null, null, "Pendente", "", null],
  "FESTA JUNINA":
    [null, null, null, "FABIANA + ESPOSO + FILHA 03 anos", null, null, null, null, null, null, null, "", null],
  "Almoço":
    [null, null, null, "", null, null, null, null, null, null, "Pendente", "", null],
};

function sheetRange(tabName: string, cell: string): string {
  return `'${tabName}'!${cell}`;
}

function colLetter(index: number): string {
  let letter = "";
  let n = index;
  while (n >= 0) {
    letter = String.fromCharCode((n % 26) + 65) + letter;
    n = Math.floor(n / 26) - 1;
  }
  return letter;
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const targetId = searchParams.get("spreadsheetId")?.trim();
  if (!targetId) return NextResponse.json({ error: "spreadsheetId param required" }, { status: 400 });

  // Encontra o cliente pelo spreadsheetId
  const clients = getClients();
  let refreshToken: string | undefined;
  for (const client of clients) {
    for (const cfg of getAllAgentConfigs(client)) {
      if (cfg.spreadsheetId === targetId && cfg.googleRefreshToken) {
        refreshToken = cfg.googleRefreshToken;
        break;
      }
    }
    if (refreshToken) break;
  }

  if (!refreshToken) {
    return NextResponse.json(
      { error: "Nenhum cliente com esse spreadsheetId e googleRefreshToken encontrado" },
      { status: 404 }
    );
  }

  const sheets = await getSheetsClientFromToken(refreshToken);

  // Busca sheetId de cada aba
  const { data } = await sheets.spreadsheets.get({
    spreadsheetId: targetId,
    fields: "sheets.properties",
  });

  const tabMap = new Map<string, number>(
    (data.sheets ?? []).map((s) => [s.properties?.title ?? "", s.properties?.sheetId ?? 0])
  );

  const results: Record<string, string> = {};

  for (const tab of TABS) {
    const sheetId = tabMap.get(tab);
    if (sheetId === undefined) {
      results[tab] = "SKIP — aba não encontrada";
      continue;
    }

    try {
      // Modificações estruturais em batch
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: targetId,
        requestBody: {
          requests: [
            // Inserir "Pessoas" em D (índice 3)
            {
              insertDimension: {
                range: { sheetId, dimension: "COLUMNS", startIndex: 3, endIndex: 4 },
                inheritFromBefore: false,
              },
            },
            // Inserir "Cidade" em L (índice 11, após o shift acima)
            {
              insertDimension: {
                range: { sheetId, dimension: "COLUMNS", startIndex: 11, endIndex: 12 },
                inheritFromBefore: false,
              },
            },
            // Cabeçalho D1 = "Pessoas"
            {
              updateCells: {
                rows: [{ values: [{ userEnteredValue: { stringValue: "Pessoas" } }] }],
                fields: "userEnteredValue",
                start: { sheetId, rowIndex: 0, columnIndex: 3 },
              },
            },
            // Cabeçalho L1 = "Cidade"
            {
              updateCells: {
                rows: [{ values: [{ userEnteredValue: { stringValue: "Cidade" } }] }],
                fields: "userEnteredValue",
                start: { sheetId, rowIndex: 0, columnIndex: 11 },
              },
            },
            // Dropdown Status (col K = índice 10), linhas 2–201
            {
              setDataValidation: {
                range: {
                  sheetId,
                  startRowIndex: 1,
                  endRowIndex: 201,
                  startColumnIndex: 10,
                  endColumnIndex: 11,
                },
                rule: {
                  condition: {
                    type: "ONE_OF_LIST",
                    values: [
                      { userEnteredValue: "Pago" },
                      { userEnteredValue: "Parcial" },
                      { userEnteredValue: "Pendente" },
                    ],
                  },
                  inputMessage: "Selecione o status de pagamento",
                  strict: true,
                  showCustomUi: true,
                },
              },
            },
          ],
        },
      });

      // Correções na linha 2 (apenas células com valor não-nulo e não-vazio)
      const fixes = ROW2_FIXES[tab] ?? [];
      for (let col = 0; col < fixes.length; col++) {
        const value = fixes[col];
        if (value === null || value === "") continue;
        await sheets.spreadsheets.values.update({
          spreadsheetId: targetId,
          range: sheetRange(tab, `${colLetter(col)}2`),
          valueInputOption: "USER_ENTERED",
          requestBody: { values: [[value]] },
        });
      }

      results[tab] = "OK";
    } catch (err) {
      results[tab] = `ERRO: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  return NextResponse.json({ ok: true, spreadsheetId: targetId, results });
}
