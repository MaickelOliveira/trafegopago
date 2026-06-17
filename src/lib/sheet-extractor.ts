import { GoogleGenerativeAI } from "@google/generative-ai";
import { getSheetHeadersCached } from "./google-sheets";
import type { ChatMessage } from "./conversations";
import type { SheetTabMapping } from "./clients";

type TabInfo = { label: string; tabName: string; headers: string[] };

// Usa gemini-3.1-flash-lite (modelo barato) para extrair dados de reserva
// da conversa e escrever no Google Apps Script (gratuito, sem OAuth de Sheets).
export async function extractAndWriteToSheet(opts: {
  apiKey: string;
  appsScriptUrl: string;
  spreadsheetId: string;
  googleRefreshToken: string;
  sheetMappings: SheetTabMapping[];
  messages: ChatMessage[];
  phone: string;
}): Promise<void> {
  const { apiKey, appsScriptUrl, spreadsheetId, googleRefreshToken, sheetMappings, messages, phone } = opts;

  if (!messages.length || !sheetMappings.length) return;

  // Carrega headers de cada aba (vem do cache — sem custo real na maioria dos casos)
  const tabs: TabInfo[] = [];
  for (const m of sheetMappings) {
    try {
      const headers = await getSheetHeadersCached(googleRefreshToken, spreadsheetId, m.tabName);
      if (headers.length > 0) tabs.push({ label: m.label, tabName: m.tabName, headers });
    } catch {
      // ignora erro de aba individual
    }
  }
  if (tabs.length === 0) return;

  // Apenas as últimas 6 mensagens para manter o prompt pequeno
  const recent = messages.slice(-6);
  const conversation = recent
    .map((m) => `${m.role === "user" ? "Cliente" : "Atendente"}: ${m.content.slice(0, 400)}`)
    .join("\n");

  const tabsInfo = tabs
    .map((t) => `• "${t.label}" → colunas: ${t.headers.join(", ")}`)
    .join("\n");

  const prompt = `Você extrai dados de reservas de conversas de WhatsApp.

Abas da planilha disponíveis:
${tabsInfo}

Telefone do cliente: ${phone}

Analise a conversa abaixo e extraia APENAS dados que o cliente confirmou (nome, data, pessoas, valores etc.).
Retorne SOMENTE um array JSON — sem markdown, sem explicação:
[{"aba": "nome exato da aba", "dados": {"NomeColuna": "valor"}}]

Se não houver dados de reserva confirmados, retorne: []

Conversa:
${conversation}`;

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: "gemini-3.1-flash-lite" });

  let text: string;
  try {
    const result = await model.generateContent(prompt);
    text = result.response.text().trim();
  } catch (e) {
    console.warn("[sheet-extractor] Gemini falhou:", e instanceof Error ? e.message : e);
    return;
  }

  // Remove markdown se o modelo insistir
  const jsonStr = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
  let rows: Array<{ aba: string; dados: Record<string, string> }>;
  try {
    rows = JSON.parse(jsonStr);
    if (!Array.isArray(rows) || rows.length === 0) return;
  } catch {
    console.warn("[sheet-extractor] JSON inválido:", jsonStr.slice(0, 200));
    return;
  }

  // Envia cada linha para o Apps Script
  for (const row of rows) {
    try {
      const res = await fetch(appsScriptUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(row),
      });
      console.log(`[sheet-extractor] Apps Script aba="${row.aba}" → ${res.status}`);
    } catch (e) {
      console.error("[sheet-extractor] Erro ao chamar Apps Script:", e instanceof Error ? e.message : e);
    }
  }
}
