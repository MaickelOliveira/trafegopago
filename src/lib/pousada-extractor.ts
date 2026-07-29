import { GoogleGenerativeAI } from "@google/generative-ai";
import type { ChatMessage } from "./conversations";
import type { PousadaTipo, Pessoa, StatusReserva } from "./pousada-types";
import { createReserva, updateReserva, findReservaByPhone, atribuirQuartoLivre } from "./pousada";

function parseMoney(val: string | number | undefined): number {
  if (typeof val === "number") return val;
  if (!val) return 0;
  const num = parseFloat(String(val).replace(/R\$\s?/g, "").replace(/\./g, "").replace(",", ".").trim());
  return isNaN(num) ? 0 : num;
}

// Recalcula o valor total a partir da lista de pessoas — mais confiável que
// confiar na soma que o modelo devolveu em "valorTotal", especialmente agora
// que "pessoas" pode ser uma lista grande, mesclada de várias mensagens.
function sumPessoas(pessoas: Pessoa[]): number {
  return pessoas.reduce((acc, p) => acc + (p.gratuito ? 0 : (typeof p.valor === "number" ? p.valor : 0)), 0);
}

function buildInsertPrompt(tiposInfo: string, phone: string, conversation: string): string {
  const today = new Date().toISOString().slice(0, 10);
  return `Você extrai dados de reservas de uma pousada a partir de conversas de WhatsApp, em formato JSON estruturado.

Data de hoje: ${today}

Tipos de reserva disponíveis (use o valor de "tipo" exatamente como mostrado):
${tiposInfo}

ID interno do cliente (WhatsApp): ${phone}

REGRAS OBRIGATÓRIAS:
1. Só extraia se houver no mínimo: nome completo do responsável pela reserva confirmado na conversa.
2. "tipo" = escolha o tipo mais próximo semanticamente do assunto da conversa entre os listados acima. Se nenhum corresponder claramente, retorne [].
3. "data" = data de check-in (hospedagem) ou data do evento (day use, almoço etc), formato ISO AAAA-MM-DD. Se o cliente mencionar a data sem ano (ex: "07 de setembro", "próximo sábado"), use a "Data de hoje" acima como referência e escolha a PRÓXIMA ocorrência a partir de hoje — nunca uma data já passada.
4. "hora" = se houver horário mencionado, formato HH:MM em 24h. Senão, omita o campo.
5. "responsavel" = { "nome": nome completo de quem faz a reserva, "cpf": CPF do responsável se informado (senão omita) }.

6. Se a categoria do tipo escolhido for HOSPEDAGEM:
   - "dataCheckout" = data de saída, formato ISO AAAA-MM-DD, se o cliente informou quantas diárias ou uma data de saída (calcule a partir de "data" + número de diárias, se necessário). Omita se não for possível determinar.
   - "quarto" = número/nome do quarto ou chalé, SOMENTE se explicitamente mencionado na conversa (normalmente é atribuído depois pela equipe) — na dúvida, omita.
   - "pessoas" = array com TODOS os hóspedes, cada um com "nome" (obrigatório), "cpf" (obrigatório — ficha de hóspede sempre exige CPF de cada pessoa), e opcionalmente "rg", "nascimento" (ISO), "endereco", "cidade", "telefone", "email", "profissao", "idade" — inclua os que o cliente informou, omita os demais, NUNCA invente.

   Se a categoria do tipo escolhido for EVENTO (day use, almoço, café da manhã, etc.):
   - "pessoas" = array com TODOS os participantes, cada um com "nome" (obrigatório), "idade" (número, obrigatório se possível — usado para calcular faixas etárias infantis) e "cidade" se informada. NÃO peça CPF/RG/endereço para eventos.

   ⚠️ IMPORTANTE — "pessoas" é sempre a LISTA COMPLETA E ATUAL da reserva, não só as pessoas mencionadas na última mensagem: releia a conversa inteira e junte todo mundo que ainda faz parte da reserva. Se o cliente mandou um grupo de pessoas num dia e depois, em outra mensagem (mesmo dias depois), acrescentou mais gente à MESMA reserva, inclua TODOS — os de antes E os novos — no array. Se o cliente disser explicitamente que alguém foi removido/cancelado/não vai mais, NÃO inclua essa pessoa. Se o cliente corrigir o nome, idade ou valor de alguém já mencionado antes, use o dado mais recente. Nunca devolva só as pessoas da última mensagem quando já havia outras pessoas confirmadas antes na mesma reserva.

   Em ambos os casos, cada pessoa em "pessoas" também tem:
   - "valor" (número, valor cobrado calculado pelo atendente para aquela pessoa — obrigatório, use 0 se gratuito)
   - "gratuito" (true se a pessoa não paga, ex: criança de colo)
7. "telefone" = número de telefone/celular que o cliente informou EXPLICITAMENTE na conversa. Se o cliente disser que é o mesmo número do WhatsApp atual, ou não informar nenhum número, OMITA este campo — o sistema preenche automaticamente com o número real do WhatsApp. NUNCA invente ou copie um número de exemplo.
8. "valorTotal" = soma dos valores de "pessoas" (valor total cobrado pela reserva).
9. "valorPago" = 0 (reserva recém criada, nada foi pago ainda) — NÃO PREENCHER com outro valor.
10. "status" = sempre "pendente".
11. "cidade" = cidade do responsável, se mencionada (principalmente relevante pra tipos EVENTO).
12. "observacoes" = restrições alimentares, pedidos especiais ou informações extras, se houver.

Retorne SOMENTE um array JSON — sem markdown, sem explicação:
[{"tipo": "...", "data": "AAAA-MM-DD", "dataCheckout": "AAAA-MM-DD", "quarto": "...", "hora": "HH:MM", "responsavel": {"nome": "..."}, "telefone": "...", "pessoas": [...], "valorTotal": 0, "valorPago": 0, "status": "pendente", "cidade": "...", "observacoes": "..."}]

Se não houver dados suficientes (mínimo: nome do responsável), retorne: []

Conversa:
${conversation}`;
}

function buildUpdatePrompt(tiposInfo: string, phone: string, conversation: string): string {
  return `Você extrai dados de confirmação de pagamento de uma conversa de WhatsApp de uma pousada, para atualizar uma reserva já existente.

Tipos de reserva disponíveis (use o valor de "tipo" exatamente como mostrado):
${tiposInfo}

ID interno do cliente (WhatsApp): ${phone}

O cliente acabou de confirmar o pagamento (enviou comprovante ou confirmou Pix).

REGRAS:
1. "tipo" = escolha o tipo mais próximo semanticamente do assunto da conversa. Se nenhum corresponder, retorne [].
2. "telefone" = número que o cliente informou na conversa (para localizar a reserva). Se não encontrar, omita — o sistema usa o telefone real do WhatsApp.
3. "status" = "pago" se o cliente indicar que pagou o valor total ou enviou comprovante sem mencionar pagamento parcial. "parcial" se mencionar explicitamente que pagou apenas parte do valor.
4. Se status = "parcial", inclua "valorPago" com o valor que o cliente informou ter pago (apenas número).
5. Se status = "pago" (pagamento total), NÃO inclua "valorPago" — o sistema calcula automaticamente.

Retorne SOMENTE um array JSON — sem markdown, sem explicação:
[{"tipo": "...", "telefone": "...", "status": "pago"}]

Conversa:
${conversation}`;
}

export async function extractAndWriteToPousada(opts: {
  apiKey: string;
  clientId: string;
  tipos: PousadaTipo[];
  totalQuartos?: number;
  messages: ChatMessage[];
  phone: string;
  motivo?: string;
}): Promise<void> {
  const { apiKey, clientId, tipos, totalQuartos = 0, messages, phone, motivo } = opts;

  const isPagamento = !!(motivo && /^PAGAMENTO PIX:/i.test(motivo.trim()));
  console.log(`[pousada-extractor] iniciando — clientId=${clientId} phone=${phone} messages=${messages.length} mode=${isPagamento ? "UPDATE(pagamento)" : "INSERT(dados)"}`);

  if (!messages.length || !tipos.length) return;

  // Janela grande o suficiente pra cobrir reservas que o cliente complementa
  // em visitas separadas (ex: manda 9 hóspedes num dia, volta noutro dia e
  // manda mais 8) — com só as últimas 10 mensagens, a lista de hóspedes do
  // primeiro dia ficava fora da janela e a extração via só os novos, fazendo
  // o merge abaixo sobrescrever a reserva com uma lista incompleta.
  // ⚠️ 30 é um meio-termo — 80 chegou a multiplicar o custo da chamada por ~8x
  // (e esse extrator roda em dobro quando o cliente também grava na planilha
  // em paralelo), gerando um pico visível de uso na API do Gemini.
  const recent = messages.slice(-30);
  const conversation = recent
    .map((m) => `${m.role === "user" ? "Cliente" : "Atendente"}: ${m.content.slice(0, 500)}`)
    .join("\n");

  const tiposInfo = tipos
    .map((t) => `• tipo="${t.slug}" (${t.label}) — categoria: ${t.categoria === "hospedagem" ? "HOSPEDAGEM" : "EVENTO"}`)
    .join("\n");

  const prompt = isPagamento
    ? buildUpdatePrompt(tiposInfo, phone, conversation)
    : buildInsertPrompt(tiposInfo, phone, conversation);

  const modelsToTry = ["gemini-3.1-flash-lite", "gemini-2.5-flash"];
  const genAI = new GoogleGenerativeAI(apiKey);

  let text: string | null = null;
  for (const modelId of modelsToTry) {
    try {
      const model = genAI.getGenerativeModel({ model: modelId });
      const result = await model.generateContent(prompt);
      text = result.response.text().trim();
      if (text) {
        console.log(`[pousada-extractor] Gemini OK model=${modelId}`);
        break;
      }
    } catch (e) {
      console.warn(`[pousada-extractor] Gemini model=${modelId} falhou:`, e instanceof Error ? e.message : e);
    }
  }
  if (!text) {
    console.warn("[pousada-extractor] Todos os modelos Gemini falharam — abortando");
    return;
  }

  const jsonStr = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
  let rows: Array<Record<string, unknown>>;
  try {
    rows = JSON.parse(jsonStr);
    if (!Array.isArray(rows) || rows.length === 0) {
      console.log("[pousada-extractor] Nenhum dado para registrar");
      return;
    }
  } catch {
    console.warn("[pousada-extractor] JSON inválido:", jsonStr.slice(0, 200));
    return;
  }

  const tipoSlugs = new Set(tipos.map((t) => t.slug));

  for (const row of rows) {
    const tipo = row.tipo as string;
    if (!tipoSlugs.has(tipo)) {
      console.warn(`[pousada-extractor] Tipo não encontrado: "${tipo}" — pulando`);
      continue;
    }

    if (isPagamento) {
      const lookupPhone = (row.telefone as string) || phone;
      try {
        const existing = findReservaByPhone(clientId, lookupPhone, tipo);
        if (!existing) {
          console.warn(`[pousada-extractor] Reserva não encontrada para phone=${lookupPhone} tipo="${tipo}"`);
          continue;
        }
        const status = (row.status as StatusReserva) ?? "pago";
        const patch: Record<string, unknown> = { status };
        if (status === "pago") {
          patch.valorPago = existing.valorTotal;
          patch.faltaPagar = 0;
        } else if (status === "parcial") {
          const valorPago = parseMoney(row.valorPago as string | number | undefined);
          patch.valorPago = valorPago;
          patch.faltaPagar = Math.max(existing.valorTotal - valorPago, 0);
        }
        updateReserva(existing.id, patch);
        console.log(`[pousada-extractor] updateReserva OK id=${existing.id} status=${status}`);
      } catch (e) {
        console.error("[pousada-extractor] updateReserva ERRO:", e instanceof Error ? e.message : e);
      }
    } else {
      try {
        const pessoas = (Array.isArray(row.pessoas) ? row.pessoas : []) as Pessoa[];

        // Telefone: se o número extraído não aparece literalmente na conversa
        // (alucinação — ex: cliente disse "é esse mesmo número"), usa o
        // telefone real do WhatsApp.
        let telefone: string = (row.telefone as string | undefined) ?? phone;
        const extractedDigits = telefone.replace(/\D/g, "");
        const convDigits = conversation.replace(/\D/g, "");
        if (!extractedDigits || extractedDigits.length < 8 || !convDigits.includes(extractedDigits)) {
          telefone = phone;
        }

        // "data" resolvida (com fallback pra hoje) — usada tanto pra localizar
        // uma reserva existente quanto pra criar/atualizar, garantindo que os
        // dois usem exatamente a mesma referência.
        const dataReserva = (row.data as string | undefined) ?? new Date().toISOString().slice(0, 10);

        // Evita duplicar quando o agente confirma "dados recebidos" mais de
        // uma vez pra MESMA reserva (mesmo telefone, tipo E data). Se o
        // telefone e o tipo baterem mas a DATA for outra (ex: a mesma pessoa
        // reservando o Day Use de outro fim de semana), NÃO é a mesma reserva
        // — cai no createReserva abaixo e cria uma reserva nova, em vez de
        // sobrescrever a reserva antiga com a data/dados da nova.
        const existing = findReservaByPhone(clientId, telefone, tipo, dataReserva);
        const valorTotal = parseMoney(row.valorTotal as string | number | undefined);
        const responsavel = (row.responsavel as { nome: string; cpf?: string }) ?? { nome: "Não informado" };

        // Auto-atribui o primeiro quarto/chalé livre pra reservas de Hospedagem
        // sem quarto explícito — sem isso, reservas fechadas pela IA nunca
        // tinham número de quarto (fica "pra equipe decidir depois" no prompt)
        // e por isso nunca apareciam na tela de Ocupação. Só tenta quando o
        // cliente configurou o total de quartos/chalés.
        const tipoInfo = tipos.find((t) => t.slug === tipo);
        const isHospedagem = tipoInfo?.categoria === "hospedagem";
        const dataCheckoutReserva = (row.dataCheckout as string | undefined) ?? existing?.dataCheckout ?? dataReserva;
        function resolveQuarto(quartoAtual?: string): string | undefined {
          if (quartoAtual) return quartoAtual;
          if (!isHospedagem || totalQuartos <= 0) return quartoAtual;
          return atribuirQuartoLivre(clientId, totalQuartos, dataReserva, dataCheckoutReserva);
        }

        if (existing) {
          const alreadyPaid = existing.status === "pago" || existing.status === "parcial";
          // Se a extração trouxe pessoas, ela é a lista completa e atual da
          // reserva (ver instrução no prompt) — usa ela e recalcula o valor
          // total a partir dela, em vez de confiar cegamente na soma que o
          // modelo devolveu separadamente (que pode não bater com a lista).
          const finalPessoas = pessoas.length ? pessoas : existing.pessoas;
          const finalValorTotal = pessoas.length
            ? (sumPessoas(pessoas) || valorTotal || existing.valorTotal)
            : (valorTotal || existing.valorTotal);
          updateReserva(existing.id, {
            data: dataReserva,
            dataCheckout: (row.dataCheckout as string) ?? existing.dataCheckout,
            quarto: resolveQuarto((row.quarto as string) ?? existing.quarto),
            hora: (row.hora as string) ?? existing.hora,
            responsavel,
            telefone,
            pessoas: finalPessoas,
            valorTotal: finalValorTotal,
            cidade: (row.cidade as string) ?? existing.cidade,
            observacoes: (row.observacoes as string) ?? existing.observacoes,
            ...(alreadyPaid ? {} : { status: "pendente" as StatusReserva, valorPago: 0, faltaPagar: finalValorTotal }),
          });
          console.log(`[pousada-extractor] updateReserva (evitou duplicar) OK id=${existing.id} responsável="${responsavel.nome}" pessoas=${finalPessoas.length}`);
        } else {
          const created = createReserva({
            clientId,
            tipo,
            data: dataReserva,
            dataCheckout: row.dataCheckout as string | undefined,
            quarto: resolveQuarto(row.quarto as string | undefined),
            hora: row.hora as string | undefined,
            responsavel,
            telefone,
            pessoas,
            valorTotal,
            valorPago: 0,
            status: "pendente",
            cidade: row.cidade as string | undefined,
            observacoes: row.observacoes as string | undefined,
            origem: "ia",
          });
          console.log(`[pousada-extractor] createReserva OK id=${created.id} responsável="${responsavel.nome}" quarto=${created.quarto ?? "—"}`);
        }
      } catch (e) {
        console.error("[pousada-extractor] insert/update ERRO:", e instanceof Error ? e.message : e);
      }
    }
  }
}
