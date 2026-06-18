import { GoogleGenerativeAI } from "@google/generative-ai";
import { getSheetHeadersCached, appendRow, findLastRowByPhone, updateRowFields } from "./google-sheets";
import type { ChatMessage } from "./conversations";
import type { SheetTabMapping } from "./clients";

type TabInfo = { label: string; tabName: string; headers: string[] };

function buildInsertPrompt(tabsInfo: string, phone: string, conversation: string): string {
  return `Você extrai dados de reservas de conversas de WhatsApp para preencher uma planilha de controle.

Abas disponíveis (use o valor de "aba" exatamente como mostrado):
${tabsInfo}

Telefone do cliente: ${phone}

REGRAS OBRIGATÓRIAS:
1. Só extraia se houver no mínimo: nome do responsável confirmado na conversa
2. "Responsável" = nome completo de quem faz a reserva
3. "Data" = data desejada para o evento (hospedagem, almoço, day use ou festa)
4. "Pessoas" = todos os participantes: "Nome Sobrenome (XX anos) - R$XX, Nome2 (XX anos) - R$XX"
   Se não souber a idade, omita: "Nome Sobrenome - R$XX"
5. "Telefone" = ${phone}
6. "Qtd. Pessoas" = número total de pessoas (adultos + crianças)
7. "Valor por Pessoa" = NÃO PREENCHER — deixe vazio
8. "Valor Total" = valor total cobrado pela reserva
9. "Valor Pago" = NÃO PREENCHER — deixe vazio (será preenchido quando o cliente enviar o comprovante)
10. "Falta Pagar" = NÃO PREENCHER — deixe vazio
11. "Status" = sempre "Pendente" (pagamento ainda não confirmado)
12. "Cidade" = cidade do cliente se mencionada
13. "Observações" = restrições alimentares, pedidos especiais ou informações extras

Determine a aba correta pelo tipo de reserva mencionado na conversa:
- Almoço de fim de semana → aba de almoço
- Day Use → aba de day use
- Hospedagem → aba de hospedagem
- Festa junina / Arraiá / ingressos → aba de festa/arraiá

Retorne SOMENTE um array JSON — sem markdown, sem explicação:
[{"aba": "valor exato do campo aba mostrado acima", "dados": {"NomeColuna": "valor"}}]

Se não houver dados suficientes (mínimo: nome do responsável), retorne: []

Conversa:
${conversation}`;
}

function buildUpdatePrompt(tabsInfo: string, phone: string, conversation: string): string {
  return `Você extrai dados de pagamento de conversas de WhatsApp para atualizar uma planilha de reservas.

Abas disponíveis (use o valor de "aba" exatamente como mostrado):
${tabsInfo}

Telefone do cliente: ${phone}

O cliente acabou de confirmar o pagamento (enviou comprovante ou confirmou Pix).
Extraia APENAS os campos de pagamento para ATUALIZAR a linha existente deste cliente.

REGRAS:
1. "Valor Pago" = valor que o cliente pagou (extraia da conversa)
2. "Falta Pagar" = calcule apenas se for pagamento parcial (Valor Total - Valor Pago). Se pagou integral, deixe vazio
3. "Status" = "Pago" se pagou o valor total, "Parcial" se pagou apenas parte
4. NÃO inclua outros campos — retorne apenas os 3 acima (mais os que souber com certeza)

Determine a aba correta pelo tipo de reserva mencionado na conversa.

Retorne SOMENTE um array JSON — sem markdown, sem explicação:
[{"aba": "valor exato do campo aba mostrado acima", "dados": {"Status": "Pago", "Valor Pago": "R$XXX,XX"}}]

Conversa:
${conversation}`;
}

export async function extractAndWriteToSheet(opts: {
  apiKey: string;
  spreadsheetId: string;
  googleRefreshToken: string;
  sheetMappings: SheetTabMapping[];
  messages: ChatMessage[];
  phone: string;
  motivo?: string;
}): Promise<void> {
  const { apiKey, spreadsheetId, googleRefreshToken, sheetMappings, messages, phone, motivo } = opts;

  const isPagamento = !!(motivo && /pagamento|pix|comprovante/i.test(motivo));
  console.log(`[sheet-extractor] iniciando — phone=${phone} messages=${messages.length} mode=${isPagamento ? "UPDATE(pagamento)" : "INSERT(dados)"}`);

  if (!messages.length || !sheetMappings.length) return;

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

  const recent = messages.slice(-10);
  const conversation = recent
    .map((m) => `${m.role === "user" ? "Cliente" : "Atendente"}: ${m.content.slice(0, 500)}`)
    .join("\n");

  const tabsInfo = tabs
    .map((t) => `• aba="${t.tabName}" (tipo: ${t.label}) → colunas: ${t.headers.join(", ")}`)
    .join("\n");

  const prompt = isPagamento
    ? buildUpdatePrompt(tabsInfo, phone, conversation)
    : buildInsertPrompt(tabsInfo, phone, conversation);

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

  for (const row of rows) {
    const tab = tabs.find((t) => t.tabName === row.aba);
    if (!tab) {
      console.warn(`[sheet-extractor] Aba não encontrada: "${row.aba}" — pulando`);
      continue;
    }

    if (isPagamento) {
      // Modo UPDATE: encontra a linha existente pelo telefone e atualiza
      try {
        const rowIndex = await findLastRowByPhone(googleRefreshToken, spreadsheetId, tab.tabName, phone);
        if (rowIndex) {
          await updateRowFields(googleRefreshToken, spreadsheetId, tab.tabName, tab.headers, rowIndex, row.dados);
          console.log(`[sheet-extractor] updateRow OK aba="${tab.tabName}" row=${rowIndex} campos=${JSON.stringify(row.dados)}`);
        } else {
          console.warn(`[sheet-extractor] Linha não encontrada para phone=${phone} em aba="${tab.tabName}"`);
        }
      } catch (e) {
        console.error(`[sheet-extractor] updateRow ERRO aba="${tab.tabName}":`, e instanceof Error ? e.message : e);
      }
    } else {
      // Modo INSERT: adiciona nova linha com Status = Pendente
      if (!row.dados["Status"]) row.dados["Status"] = "Pendente";
      if (!row.dados["Telefone"]) row.dados["Telefone"] = phone;
      try {
        await appendRow(googleRefreshToken, spreadsheetId, tab.tabName, tab.headers, row.dados);
        console.log(`[sheet-extractor] appendRow OK aba="${tab.tabName}" responsável="${row.dados["Responsável"] ?? "?"}"`);
      } catch (e) {
        console.error(`[sheet-extractor] appendRow ERRO aba="${tab.tabName}":`, e instanceof Error ? e.message : e);
      }
    }
  }
}
