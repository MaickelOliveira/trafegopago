import { GoogleGenerativeAI } from "@google/generative-ai";
import { getSheetHeadersCached, appendRow } from "./google-sheets";
import type { ChatMessage } from "./conversations";
import type { SheetTabMapping } from "./clients";

type TabInfo = { label: string; tabName: string; headers: string[] };

// Usa Gemini 2.0 Flash (modelo barato) para extrair dados de reserva
// da conversa e escrever diretamente no Google Sheets via OAuth.
// Só deve ser chamado quando o agente principal chamou enviar_resumo
// (dados coletados ou pagamento confirmado) — evita linhas duplicadas.
export async function extractAndWriteToSheet(opts: {
  apiKey: string;
  spreadsheetId: string;
  googleRefreshToken: string;
  sheetMappings: SheetTabMapping[];
  messages: ChatMessage[];
  phone: string;
}): Promise<void> {
  const { apiKey, spreadsheetId, googleRefreshToken, sheetMappings, messages, phone } = opts;

  console.log(`[sheet-extractor] iniciando — phone=${phone} messages=${messages.length} mappings=${sheetMappings.length}`);
  if (!messages.length || !sheetMappings.length) return;

  // Carrega headers de cada aba (cacheados)
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

  // Últimas 10 mensagens para ter contexto completo da reserva
  const recent = messages.slice(-10);
  const conversation = recent
    .map((m) => `${m.role === "user" ? "Cliente" : "Atendente"}: ${m.content.slice(0, 500)}`)
    .join("\n");

  const tabsInfo = tabs
    .map((t) => `• aba="${t.tabName}" (tipo: ${t.label}) → colunas: ${t.headers.join(", ")}`)
    .join("\n");

  const prompt = `Você extrai dados de reservas de conversas de WhatsApp para preencher uma planilha de controle.

Abas disponíveis (use o valor de "aba" exatamente como mostrado):
${tabsInfo}

Telefone do cliente: ${phone}

REGRAS OBRIGATÓRIAS DE EXTRAÇÃO:
1. Só extraia se houver no mínimo: nome do responsável + telefone confirmados
2. "Responsável" = nome completo de quem faz a reserva (quem está conversando)
3. "Data" = data desejada para o evento (hospedagem, almoço, day use ou festa)
4. "Pessoas" = lista de participantes no formato: "Nome Sobrenome (XX anos) - R$XX, Nome2 (XX anos) - R$XX"
   - Inclua TODOS os participantes com nome, idade (se informada) e valor individual
   - Se não souber a idade, omita: "Nome Sobrenome - R$XX"
5. "Telefone" = use o telefone do cliente: ${phone}
6. "Qtd. Pessoas" = número total de pessoas (adultos + crianças)
7. "Valor por Pessoa" = NÃO PREENCHER — deixe vazio
8. "Valor Total" = valor total cobrado pela reserva
9. "Valor Pago" = preencha SOMENTE se o cliente confirmou que pagou ou enviou comprovante nesta conversa
10. "Falta Pagar" = preencha SOMENTE se houve pagamento parcial (calcule: Valor Total - Valor Pago)
11. "Status" = "Pendente" (sem pagamento), "Pago" (pagamento integral confirmado), "Parcial" (pagamento parcial)
12. "Cidade" = cidade do cliente se mencionada
13. "Observações" = restrições alimentares, pedidos especiais, ou qualquer informação extra relevante

Determine a aba correta baseando-se no tipo de reserva mencionado na conversa:
- Almoço de fim de semana → aba de almoço
- Day Use → aba de day use
- Hospedagem → aba de hospedagem
- Festa junina / Arraiá / ingressos → aba de festa/arraiá
- Se não houver aba específica, use a aba mais adequada disponível

Retorne SOMENTE um array JSON — sem markdown, sem explicação:
[{"aba": "valor exato do campo aba mostrado acima", "dados": {"NomeColuna": "valor"}}]

Se não houver dados suficientes (mínimo: nome + telefone), retorne: []

Conversa:
${conversation}`;

  const modelsToTry = ["gemini-2.0-flash-lite", "gemini-2.0-flash", "gemini-2.5-flash"];
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

  const jsonStr = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
  let rows: Array<{ aba: string; dados: Record<string, string> }>;
  try {
    rows = JSON.parse(jsonStr);
    if (!Array.isArray(rows) || rows.length === 0) {
      console.log("[sheet-extractor] Nenhum dado para registrar");
      return;
    }
  } catch {
    console.warn("[sheet-extractor] JSON inválido:", jsonStr.slice(0, 200));
    return;
  }

  // Garante que "aba" contém o tabName real (o modelo pode devolver o label)
  for (const row of rows) {
    const byLabel = tabs.find((t) => t.label === row.aba);
    if (byLabel) row.aba = byLabel.tabName;
  }
  console.log(`[sheet-extractor] rows: ${JSON.stringify(rows.map(r => ({ aba: r.aba, keys: Object.keys(r.dados) })))}`);

  // Escreve cada linha diretamente no Google Sheets via OAuth
  for (const row of rows) {
    const tab = tabs.find((t) => t.tabName === row.aba);
    if (!tab) {
      console.warn(`[sheet-extractor] Aba não encontrada: "${row.aba}" — pulando`);
      continue;
    }
    try {
      await appendRow(googleRefreshToken, spreadsheetId, tab.tabName, tab.headers, row.dados);
      console.log(`[sheet-extractor] appendRow OK aba="${tab.tabName}" responsável="${row.dados["Responsável"] ?? "?"}" telefone="${row.dados["Telefone"] ?? phone}"`);
    } catch (e) {
      console.error(`[sheet-extractor] appendRow ERRO aba="${tab.tabName}":`, e instanceof Error ? e.message : e);
    }
  }
}
