import { google } from "googleapis";
import { getOAuth2Client } from "./google-calendar";

async function getSheetsClient(refreshToken: string) {
  const oauth2 = getOAuth2Client();
  oauth2.setCredentials({ refresh_token: refreshToken });
  return google.sheets({ version: "v4", auth: oauth2 });
}

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
  const skipFirst = headers.length > 0 && isAutoNum(headers[0]);
  const startCol = skipFirst ? "B" : "A";
  const dataHeaders = skipFirst ? headers.slice(1) : headers;
  const row = dataHeaders.map((h) => values[h] ?? "");

  // Encontra a primeira linha vazia na coluna de início (ignora auto-numeração em A)
  const { data: colData } = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${sheetName}!${startCol}:${startCol}`,
  });
  const existing = colData.values ?? [];
  // existing[0] = cabeçalho; procura a partir do índice 1
  let targetIndex = existing.length; // padrão: depois da última linha com dado
  for (let i = 1; i < existing.length; i++) {
    if (!existing[i] || existing[i].length === 0 || String(existing[i][0]).trim() === "") {
      targetIndex = i;
      break;
    }
  }
  const targetRow = targetIndex + 1; // converte para 1-indexed

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${sheetName}!${startCol}${targetRow}`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [row] },
  });
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
