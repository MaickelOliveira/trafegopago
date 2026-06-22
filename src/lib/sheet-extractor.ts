import { GoogleGenerativeAI } from "@google/generative-ai";
import { getSheetHeadersCached, appendRow, findLastRowByPhone, updateRowFields, getRowValues } from "./google-sheets";
import type { ChatMessage } from "./conversations";
import type { SheetTabMapping } from "./clients";

type TabInfo = { label: string; tabName: string; headers: string[] };

function findHeader(headers: string[], regex: RegExp): string | undefined {
  return headers.find((h) => regex.test(h));
}

// Conta crianças por faixa etária a partir do texto livre da coluna "Pessoas"
// (ex: "Maickel 31 anos R$50 - Clara 9 anos R$25 - Lis 3 anos Gratuito")
function countChildrenByAge(pessoasText: string): { faixa0a5: number; faixa6a12: number } {
  const ages = [...pessoasText.matchAll(/(\d{1,2})\s*anos?/gi)].map((m) => parseInt(m[1], 10));
  let faixa0a5 = 0;
  let faixa6a12 = 0;
  for (const age of ages) {
    if (age <= 5) faixa0a5++;
    else if (age <= 12) faixa6a12++;
  }
  return { faixa0a5, faixa6a12 };
}

function parseMoney(val: string | undefined): number {
  if (!val) return 0;
  const num = parseFloat(String(val).replace(/R\$\s?/g, "").replace(/\./g, "").replace(",", ".").trim());
  return isNaN(num) ? 0 : num;
}

function buildInsertPrompt(tabsInfo: string, phone: string, conversation: string): string {
  return `Você extrai dados de reservas de conversas de WhatsApp para preencher uma planilha de controle.

Abas disponíveis (use o valor de "aba" exatamente como mostrado):
${tabsInfo}

ID interno do cliente: ${phone}

REGRAS OBRIGATÓRIAS:
1. Só extraia se houver no mínimo: nome do responsável confirmado na conversa
2. "Responsável" = nome completo de quem faz a reserva
3. "Data" = data desejada para o evento no formato ISO AAAA-MM-DD (ex: 2026-06-27). O sistema converte automaticamente para DD/MM/AAAA
   Se houver coluna "Hora" ou "Horário", use formato HH:MM em 24h (ex: 14:30). NUNCA use AM/PM
4. "Pessoas" = OBRIGATÓRIO listar TODOS os participantes com valor individual calculado pelo atendente:
   Formato: "Nome Sobrenome (XX anos) - R$XX,00, Nome2 (XX anos) - R$XX,00"
   - Use os valores que o atendente calculou para cada faixa etária (adulto, criança, gratuito)
   - Se criança gratuita, escreva "Gratuito" no lugar do valor
   - NUNCA omita os valores — eles são obrigatórios neste campo
5. "Telefone" = número de telefone/celular/WhatsApp que o cliente informou EXPLICITAMENTE na conversa (não o ID interno)
   Se o cliente disser que é o mesmo número do WhatsApp atual ("é esse mesmo", "é esse aqui", "pode usar esse número", "é esse número mesmo"), OU não informar nenhum número, deixe o campo VAZIO — o sistema preenche automaticamente com o número real do WhatsApp
   NUNCA invente, suponha ou copie um número de exemplo — se não houver um número EXATO escrito pelo cliente na conversa, deixe vazio
6. "Qtd. Pessoas" = número total de pessoas (adultos + crianças)
7. "Valor por Pessoa" = NÃO PREENCHER — deixe vazio
8. "Valor Total" = valor total cobrado pela reserva
9. "Valor Pago" = NÃO PREENCHER — deixe vazio
10. "Falta Pagar" = igual ao Valor Total (pois nada foi pago ainda — reserva recém criada)
11. "Status" = sempre "Pendente"
12. "Cidade" = cidade do cliente se mencionada
13. "Observações" = restrições alimentares, pedidos especiais ou informações extras
14. Se houver colunas de faixa etária (ex: "0 - 5 anos", "6 - 12 anos"), NÃO preencha — o sistema calcula automaticamente a partir do campo Pessoas
15. Se houver coluna "N°"/"Nº"/"#", NÃO preencha — o sistema numera automaticamente

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
2. "Status" = "Pago" se o cliente indicar que pagou o valor total ou enviou comprovante sem mencionar pagamento parcial. "Parcial" se mencionar explicitamente que pagou apenas parte do valor.
3. Se Status = "Parcial", inclua "Valor Pago" com o valor que o cliente informou ter pago (apenas o número, ex: "150,00").
4. Se Status = "Pago" (pagamento total), NÃO inclua "Valor Pago" nem "Falta Pagar" — o sistema calcula automaticamente com base no Valor Total já registrado.

Determine a aba correta pelo tipo de reserva mencionado na conversa.

Retorne SOMENTE um array JSON — sem markdown, sem explicação:
[{"aba": "valor exato do campo aba mostrado acima", "dados": {"Telefone": "44999990000", "Status": "Pago"}}]

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

  // Converte valores monetários de texto ("R$ 500,00") para número puro ("500")
  // para que o SOMA() do Google Sheets consiga somar — texto é ignorado pelo SOMA
  const CURRENCY_COL = /valor|pagar|pago|total|receber/i;
  // Converte datas de ISO (AAAA-MM-DD) para DD/MM/AAAA (formato brasileiro)
  const DATE_COL = /^data$/i;
  for (const row of rows) {
    for (const key of Object.keys(row.dados)) {
      const val = row.dados[key];
      if (!val) continue;
      if (CURRENCY_COL.test(key)) {
        const num = parseFloat(val.replace(/R\$\s?/g, "").replace(/\./g, "").replace(",", ".").trim());
        if (!isNaN(num)) row.dados[key] = String(num);
      } else if (DATE_COL.test(key)) {
        // Mantém o formato ISO (AAAA-MM-DD) — Google Sheets reconhece ISO 8601
        // de forma inequívoca em qualquer locale e grava como data real (não
        // texto), permitindo SUMIFS/ordenação por data. A EXIBIÇÃO (dd/mm/aaaa
        // vs mm/dd/aaaa) depende do locale da planilha — ver Arquivo > Config.
        // da planilha > Localidade > Brasil, caso esteja mostrando mm/dd/aaaa.
        const iso = val.match(/^(\d{4}-\d{2}-\d{2})/);
        if (iso) row.dados[key] = iso[1];
      }
    }
  }

  console.log(`[sheet-extractor] rows: ${JSON.stringify(rows.map(r => ({ aba: r.aba, keys: Object.keys(r.dados) })))}`);

  for (const row of rows) {
    const tab = tabs.find((t) => t.tabName === row.aba);
    if (!tab) {
      console.warn(`[sheet-extractor] Aba não encontrada: "${row.aba}" — pulando`);
      continue;
    }

    const hValorTotal = findHeader(tab.headers, /valor\s*total/i);
    const hValorPago = findHeader(tab.headers, /valor\s*pago/i);
    const hFaltaPagar = findHeader(tab.headers, /falta\s*pagar/i);
    const hStatus = findHeader(tab.headers, /^status$/i);

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
          // Calcula Valor Pago / Falta Pagar automaticamente com base no Status,
          // lendo o Valor Total já registrado na linha — não depende do Gemini "adivinhar".
          const statusVal = hStatus ? updateData[hStatus] : undefined;
          if (statusVal && hValorTotal) {
            const current = await getRowValues(googleRefreshToken, spreadsheetId, tab.tabName, tab.headers, rowIndex);
            const valorTotal = parseMoney(current[hValorTotal]);
            if (/^pago$/i.test(statusVal.trim())) {
              if (hValorPago) updateData[hValorPago] = String(valorTotal);
              if (hFaltaPagar) updateData[hFaltaPagar] = "0";
            } else if (/parcial/i.test(statusVal)) {
              const valorPago = parseMoney(hValorPago ? updateData[hValorPago] : undefined);
              if (hFaltaPagar) updateData[hFaltaPagar] = String(Math.max(valorTotal - valorPago, 0));
            }
          }
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

      // Calcula automaticamente as colunas de faixa etária a partir do campo "Pessoas"
      const pessoasVal = row.dados["Pessoas"];
      if (pessoasVal) {
        const { faixa0a5, faixa6a12 } = countChildrenByAge(pessoasVal);
        const col05 = findHeader(tab.headers, /0\s*[-aà]\s*5/i);
        const col612 = findHeader(tab.headers, /6\s*[-aà]\s*12/i);
        if (col05) row.dados[col05] = String(faixa0a5);
        if (col612) row.dados[col612] = String(faixa6a12);
      }

      // Telefone: se o número extraído pelo Gemini não aparece literalmente na
      // conversa (alucinação — ex: cliente disse "é esse mesmo número" e o
      // modelo inventou um número de exemplo), usa o telefone real do WhatsApp.
      const phoneHeader = findHeader(tab.headers, /telefone|celular|whatsapp|fone|contato/i);
      if (phoneHeader) {
        const extractedDigits = (row.dados[phoneHeader] ?? "").replace(/\D/g, "");
        const convDigits = conversation.replace(/\D/g, "");
        if (!extractedDigits || extractedDigits.length < 8 || !convDigits.includes(extractedDigits)) {
          if (row.dados[phoneHeader] && row.dados[phoneHeader] !== phone) {
            console.warn(`[sheet-extractor] Telefone "${row.dados[phoneHeader]}" não encontrado na conversa — usando número real do WhatsApp`);
          }
          row.dados[phoneHeader] = phone;
        }
      }

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
