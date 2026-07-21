import { google } from "googleapis";
import { getOAuth2Client } from "./google-calendar";

async function getSheetsClient(refreshToken: string) {
  const oauth2 = getOAuth2Client();
  oauth2.setCredentials({ refresh_token: refreshToken });
  return google.sheets({ version: "v4", auth: oauth2 });
}

export { getSheetsClient as getSheetsClientFromToken };

async function getDriveClient(refreshToken: string) {
  const oauth2 = getOAuth2Client();
  oauth2.setCredentials({ refresh_token: refreshToken });
  return google.drive({ version: "v3", auth: oauth2 });
}

// Aceita tanto um ID puro quanto uma URL do Google Sheets e retorna o ID.
export function extractSpreadsheetId(input: string): string {
  const trimmed = input.trim();
  const match = trimmed.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  return match ? match[1] : trimmed;
}

export type DriveSpreadsheet = { id: string; name: string };

export async function listSpreadsheets(refreshToken: string): Promise<DriveSpreadsheet[]> {
  const drive = await getDriveClient(refreshToken);
  const { data } = await drive.files.list({
    q: "mimeType='application/vnd.google-apps.spreadsheet' and trashed=false",
    fields: "files(id,name)",
    orderBy: "modifiedTime desc",
    pageSize: 50,
  });
  return (data.files ?? [])
    .filter((f) => f.id && f.name)
    .map((f) => ({ id: f.id as string, name: f.name as string }));
}

export type SheetTab = { title: string; sheetId: number };

export async function getSpreadsheetInfo(
  refreshToken: string,
  spreadsheetId: string
): Promise<{ title: string; tabs: SheetTab[] }> {
  const sheets = await getSheetsClient(refreshToken);
  const { data } = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: "properties.title,sheets.properties",
  });
  return {
    title: data.properties?.title ?? "",
    tabs: (data.sheets ?? []).map((s) => ({
      title: s.properties?.title ?? "",
      sheetId: s.properties?.sheetId ?? 0,
    })),
  };
}

export async function getSheetHeaders(
  refreshToken: string,
  spreadsheetId: string,
  sheetName: string
): Promise<string[]> {
  const sheets = await getSheetsClient(refreshToken);
  const { data } = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${sheetName}!1:1`,
  });
  const row = data.values?.[0] ?? [];
  return row.map((v) => String(v ?? "").trim()).filter((v) => v.length > 0);
}

// Adiciona uma nova linha na planilha, mapeando os valores para as colunas
// pela ordem do cabeçalho — colunas sem valor ficam vazias.
// Se o primeiro cabeçalho for uma coluna de numeração automática (Nº, N°, #),
// começa a escrever a partir da segunda coluna para não sobrescrever a numeração.
export async function appendRow(
  refreshToken: string,
  spreadsheetId: string,
  sheetName: string,
  headers: string[],
  values: Record<string, string>
): Promise<void> {
  const sheets = await getSheetsClient(refreshToken);

  const isAutoNum = (h: string) => /^[nN][°º]?$/.test(h.trim()) || h.trim() === "#";
  const hasAutoNum = headers.length > 0 && isAutoNum(headers[0]);

  // Detecta linha vazia pela coluna "Responsável" — não pela "Data", pois é comum
  // o gestor pré-preencher a data em várias linhas de antemão (ex: planilha de um
  // evento com data fixa), o que faria o scan por "Data" pular essas linhas vazias
  // e inserir o registro muito mais abaixo do que deveria.
  const respIdx = headers.findIndex((h) => /respons[aá]vel/i.test(h.trim()));
  const scanCol = respIdx >= 0 ? colLetter(respIdx) : (hasAutoNum ? "B" : "A");
  const { data: colData } = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${sheetName}!${scanCol}:${scanCol}`,
  });
  const existing = colData.values ?? [];
  // existing[0] = cabeçalho; procura a partir do índice 1
  let targetIndex = existing.length;
  for (let i = 1; i < existing.length; i++) {
    if (!existing[i] || existing[i].length === 0 || String(existing[i][0]).trim() === "") {
      targetIndex = i;
      break;
    }
  }
  const targetRow = targetIndex + 1; // converte para 1-indexed

  // Monta a linha: se tiver coluna Nº, preenche com o número sequencial
  let row: string[];
  if (hasAutoNum) {
    const seqNum = String(targetRow - 1); // linha 2 = registro 1, linha 3 = 2, etc.
    const dataRow = headers.slice(1).map((h) => values[h] ?? "");
    row = [seqNum, ...dataRow];
  } else {
    row = headers.map((h) => values[h] ?? "");
  }

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${sheetName}!A${targetRow}`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [row] },
  });
}

// Converte índice de coluna (0-based) para letra(s): 0→A, 25→Z, 26→AA
function colLetter(index: number): string {
  let result = "";
  let i = index + 1;
  while (i > 0) {
    const rem = (i - 1) % 26;
    result = String.fromCharCode(65 + rem) + result;
    i = Math.floor((i - 1) / 26);
  }
  return result;
}

// Encontra o índice (1-based) da ÚLTIMA linha que contenha o telefone na coluna
// "Telefone" (ou similar). Retorna null se não encontrar.
export async function findLastRowByPhone(
  refreshToken: string,
  spreadsheetId: string,
  sheetName: string,
  phone: string
): Promise<number | null> {
  const sheets = await getSheetsClient(refreshToken);

  const { data: hData } = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${sheetName}!1:1`,
  });
  const headers: string[] = (hData.values?.[0] ?? []).map((v) => String(v ?? "").trim());
  const phoneColIdx = headers.findIndex((h) => /telefone|celular|whatsapp|fone|contato/i.test(h));
  if (phoneColIdx === -1) return null;

  const col = colLetter(phoneColIdx);
  const { data } = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${sheetName}!${col}:${col}`,
  });
  const rows = data.values ?? [];
  const phoneDigits = phone.replace(/\D/g, "");

  let lastMatch: number | null = null;
  for (let i = 1; i < rows.length; i++) {
    const cell = String(rows[i]?.[0] ?? "").replace(/\D/g, "");
    if (cell && (cell === phoneDigits || phoneDigits.endsWith(cell) || cell.endsWith(phoneDigits))) {
      lastMatch = i + 1; // 1-indexed
    }
  }
  return lastMatch;
}

// Lê todos os valores de uma linha existente (rowIndex é 1-based), mapeados por cabeçalho.
export async function getRowValues(
  refreshToken: string,
  spreadsheetId: string,
  sheetName: string,
  headers: string[],
  rowIndex: number
): Promise<Record<string, string>> {
  const sheets = await getSheetsClient(refreshToken);
  const lastCol = colLetter(headers.length - 1);
  const { data } = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${sheetName}!A${rowIndex}:${lastCol}${rowIndex}`,
  });
  const row = data.values?.[0] ?? [];
  const result: Record<string, string> = {};
  headers.forEach((h, i) => { result[h] = String(row[i] ?? ""); });
  return result;
}

// Lê todas as linhas de dados (a partir da linha 2, pulando o cabeçalho) —
// usada apenas para migração/importação única de dados históricos.
export async function getAllRows(
  refreshToken: string,
  spreadsheetId: string,
  sheetName: string,
  headers: string[]
): Promise<Record<string, string>[]> {
  const sheets = await getSheetsClient(refreshToken);
  const lastCol = colLetter(headers.length - 1);
  const { data } = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${sheetName}!A2:${lastCol}5000`,
  });
  const rows = data.values ?? [];
  return rows
    .filter((r) => r.some((v) => String(v ?? "").trim().length > 0))
    .map((r) => {
      const obj: Record<string, string> = {};
      headers.forEach((h, i) => { obj[h] = String(r[i] ?? "").trim(); });
      return obj;
    });
}

// Atualiza campos específicos em uma linha existente (rowIndex é 1-based).
export async function updateRowFields(
  refreshToken: string,
  spreadsheetId: string,
  sheetName: string,
  headers: string[],
  rowIndex: number,
  values: Record<string, string>
): Promise<void> {
  const sheets = await getSheetsClient(refreshToken);

  for (const [header, value] of Object.entries(values)) {
    const idx = headers.indexOf(header);
    if (idx === -1) continue;
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${sheetName}!${colLetter(idx)}${rowIndex}`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [[value]] },
    });
  }
}

// Cache em memória do cabeçalho de cada planilha — evita ler a planilha a
// cada mensagem recebida. TTL curto pois o gestor pode editar as colunas.
type CachedHeaders = { headers: string[]; ts: number };
const HEADERS_CACHE_TTL_MS = 5 * 60_000;
const headersCache = new Map<string, CachedHeaders>();

export async function getSheetHeadersCached(
  refreshToken: string,
  spreadsheetId: string,
  sheetName: string
): Promise<string[]> {
  const key = `${spreadsheetId}:${sheetName}`;
  const cached = headersCache.get(key);
  if (cached && Date.now() - cached.ts < HEADERS_CACHE_TTL_MS) return cached.headers;

  const headers = await getSheetHeaders(refreshToken, spreadsheetId, sheetName);
  headersCache.set(key, { headers, ts: Date.now() });
  return headers;
}
