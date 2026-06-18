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

  console.log(`[sheet-extractor] iniciando — phone=${phone} messages=${messages.length} mappings=${sheetMappings.length} url=${appsScriptUrl.slice(0, 40)}...`);
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

  // Para cada aba, mostra o tabName (chave real) e o label (rótulo amigável)
  const tabsInfo = tabs
    .map((t) => `• aba="${t.tabName}" (tipo: ${t.label}) → colunas: ${t.headers.join(", ")}`)
    .join("\n");

  const prompt = `Você extrai dados de reservas de conversas de WhatsApp.

Abas da planilha disponíveis (use o valor de "aba" exatamente como mostrado):
${tabsInfo}

Telefone do cliente: ${phone}

Analise a conversa abaixo e extraia APENAS dados que o cliente confirmou (nome, data, pessoas, valores etc.).
Retorne SOMENTE um array JSON — sem markdown, sem explicação:
[{"aba": "valor exato do campo aba mostrado acima", "dados": {"NomeColuna": "valor"}}]

Se não houver dados de reserva confirmados, retorne: []

Conversa:
${conversation}`;

  const modelsToTry = ["gemini-2.0-flash-lite", "gemini-2.5-flash", "gemini-2.0-flash"];
  const genAI = new GoogleGenerativeAI(apiKey);

  let text: string | null = null;
  for (const modelId of modelsToTry) {
    try {
      const model = genAI.getGenerativeModel({ model: modelId });
      const result = await model.generateContent(prompt);
      text = result.response.text().trim();
      if (text) {
        console.log(`[sheet-extractor] Gemini OK model=${modelId}`);
        break;
      }
    } catch (e) {
      console.warn(`[sheet-extractor] Gemini model=${modelId} falhou:`, e instanceof Error ? e.message : e);
    }
  }
  if (!text) {
    console.warn("[sheet-extractor] Todos os modelos Gemini falharam — abortando");
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

  // Garante que "aba" contém o tabName real (o modelo pode devolver o label)
  for (const row of rows) {
    const byLabel = tabs.find((t) => t.label === row.aba);
    if (byLabel) row.aba = byLabel.tabName;
    // Se o modelo já devolveu o tabName correto, mantém como está
  }
  console.log(`[sheet-extractor] rows após resolução de aba: ${JSON.stringify(rows.map(r => ({ aba: r.aba, keys: Object.keys(r.dados) })))}`);

  // Envia cada linha para o Apps Script
  for (const row of rows) {
    try {
      const res = await fetch(appsScriptUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...row, spreadsheetId }),
      });
      console.log(`[sheet-extractor] Apps Script aba="${row.aba}" → ${res.status}`);
    } catch (e) {
      console.error("[sheet-extractor] Erro ao chamar Apps Script:", e instanceof Error ? e.message : e);
    }
  }
}
