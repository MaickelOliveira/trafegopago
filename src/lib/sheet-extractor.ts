import { GoogleGenerativeAI } from "@google/generative-ai";
import { getSheetHeadersCached, appendRow, findLastRowByPhone, updateRowFields } from "./google-sheets";
import type { ChatMessage } from "./conversations";
import type { SheetTabMapping } from "./clients";

type TabInfo = { label: string; tabName: string; headers: string[] };

function buildInsertPrompt(tabsInfo: string, phone: string, conversation: string): string {
  return `Você extrai dados de reservas de conversas de WhatsApp para preencher uma planilha de controle.

Abas disponíveis (use o valor de "aba" exatamente como mostrado):
${tabsInfo}

ID interno do cliente: ${phone}

REGRAS OBRIGATÓRIAS:
1. Só extraia se houver no mínimo: nome do responsável confirmado na conversa
2. "Responsável" = nome completo de quem faz a reserva
3. "Data" = data desejada para o evento no formato DD/MM/AAAA (ex: 27/06/2026). NUNCA use formato MM/DD/AAAA
4. "Pessoas" = OBRIGATÓRIO listar TODOS os participantes com valor individual calculado pelo atendente:
   Formato: "Nome Sobrenome (XX anos) - R$XX,00, Nome2 (XX anos) - R$XX,00"
   - Use os valores que o atendente calculou para cada faixa etária (adulto, criança, gratuito)
   - Se criança gratuita, escreva "Gratuito" no lugar do valor
   - NUNCA omita os valores — eles são obrigatórios neste campo
5. "Telefone" = número de telefone/celular/WhatsApp que o cliente informou na conversa (não o ID interno)
   Se o cliente não informou um número explícito, deixe vazio
6. "Qtd. Pessoas" = número total de pessoas (adultos + crianças)
7. "Valor por Pessoa" = NÃO PREENCHER — deixe vazio
8. "Valor Total" = valor total cobrado pela reserva
9. "Valor Pago" = NÃO PREENCHER — deixe vazio
10. "Falta Pagar" = igual ao Valor Total (pois nada foi pago ainda — reserva recém criada)
11. "Status" = sempre "Pendente"
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

ID interno do cliente: ${phone}

O cliente acabou de confirmar o pagamento (enviou comprovante ou confirmou Pix).
Extraia os campos abaixo para ATUALIZAR a linha existente deste cliente.

REGRAS:
1. "Telefone" = número de telefone/celular que o cliente informou na conversa (para localizar a linha). Se não encontrar, deixe vazio
2. "Valor Pago" = valor que o cliente pagou (extraia da conversa)
3. "Falta Pagar" = Valor Total - Valor Pago se pagou parcialmente. Se pagou o total, deixe vazio (ou "R$ 0,00")
4. "Status" = "Pago" se pagou o valor total, "Parcial" se pagou apenas parte

Determine a aba correta pelo tipo de reserva mencionado na conversa.

Retorne SOMENTE um array JSON — sem markdown, sem explicação:
[{"aba": "valor exato do campo aba mostrado acima", "dados": {"Telefone": "44999990000", "Status": "Pago", "Valor Pago": "R$XXX,XX"}}]

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

  // Só entra em modo UPDATE quando o motivo começa explicitamente com "PAGAMENTO PIX:"
  // Evita falso positivo quando motivo diz "aguardando pagamento" (que ainda é INSERT)
  const isPagamento = !!(motivo && /^PAGAMENTO PIX:/i.test(motivo.trim()));
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

  const modelsToTry = ["gemini-3.1-flash-lite", "gemini-2.5-flash"];
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
      // Prefere o telefone extraído da conversa; cai no LID como último recurso
      const lookupPhone = row.dados["Telefone"] || phone;
      // Remove Telefone dos dados para não sobrescrever o valor original na planilha
      const updateData = { ...row.dados };
      delete updateData["Telefone"];
      try {
        const rowIndex = await findLastRowByPhone(googleRefreshToken, spreadsheetId, tab.tabName, lookupPhone);
        if (rowIndex) {
          await updateRowFields(googleRefreshToken, spreadsheetId, tab.tabName, tab.headers, rowIndex, updateData);
          console.log(`[sheet-extractor] updateRow OK aba="${tab.tabName}" row=${rowIndex} campos=${JSON.stringify(updateData)}`);
        } else {
          console.warn(`[sheet-extractor] Linha não encontrada para phone=${lookupPhone} em aba="${tab.tabName}"`);
        }
      } catch (e) {
        console.error(`[sheet-extractor] updateRow ERRO aba="${tab.tabName}":`, e instanceof Error ? e.message : e);
      }
    } else {
      // Modo INSERT: adiciona nova linha com Status = Pendente
      if (!row.dados["Status"]) row.dados["Status"] = "Pendente";
      // Não sobrescreve o telefone se o modelo extraiu um da conversa
      try {
        await appendRow(googleRefreshToken, spreadsheetId, tab.tabName, tab.headers, row.dados);
        console.log(`[sheet-extractor] appendRow OK aba="${tab.tabName}" responsável="${row.dados["Responsável"] ?? "?"}"`);
      } catch (e) {
        console.error(`[sheet-extractor] appendRow ERRO aba="${tab.tabName}":`, e instanceof Error ? e.message : e);
      }
    }
  }
}
