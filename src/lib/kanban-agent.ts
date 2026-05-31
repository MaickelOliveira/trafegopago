/**
 * Agente silencioso de CRM — roda após cada mensagem do WhatsApp,
 * analisa a conversa e atualiza o Kanban automaticamente.
 * Não interfere com o agente de atendimento existente.
 */

import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";
import { getClientById } from "./clients";
import { getGeminiApiKey } from "./whatsapp-send";
import { updateLead, getLeadByPhone } from "./leads";
import { getFunnelById } from "./funnels";
import { sendCapiEvent } from "./meta-capi";
import type { ChatMessage } from "./conversations";
import type { Lead } from "./leads";
import type { Funnel } from "./funnels";

type KanbanAction =
  | { type: "mover_lead"; colunaId: string; motivo: string }
  | { type: "atualizar_lead"; nome?: string; notas?: string; valor?: number };

function buildSystemPrompt(lead: Lead, funnel: Funnel, agentSystemPrompt?: string): string {
  const columns = funnel.columns ?? [];
  const colunaAtual = columns.find((c) => c.id === lead.status);

  // Colunas que o agente PODE mover (blockAutoMove !== true)
  const colunasPermitidas = columns.filter((c) => !c.blockAutoMove);
  const colunasBloqueadas = columns.filter((c) => c.blockAutoMove);

  const listaPermitidas = colunasPermitidas
    .map((c) => {
      const linhas: string[] = [];
      // Contexto IA (descrição configurada pelo gestor)
      if (c.aiDescription) linhas.push(`  Contexto: ${c.aiDescription}`);
      // Frases de gatilho
      if (c.triggerPhrases?.length) {
        linhas.push(`  Gatilhos: ${c.triggerPhrases.map((f) => `"${f}"`).join(", ")}`);
      }
      // Whitelist de transições (camada 3)
      if (c.allowedTransitions?.length) {
        const labels = c.allowedTransitions
          .map((id) => columns.find((x) => x.id === id)?.label ?? id)
          .join(", ");
        linhas.push(`  Pode receber leads vindos de: ${labels}`);
      }
      const detalhe = linhas.length ? "\n" + linhas.join("\n") : "";
      return `• ${c.id} → ${c.label}${c.id === lead.status ? " (ETAPA ATUAL)" : ""}${detalhe}`;
    })
    .join("\n");

  const listaBloqueadas = colunasBloqueadas.length > 0
    ? `\nColunas BLOQUEADAS para movimentação automática (preenchidas manualmente):\n${colunasBloqueadas.map((c) => `• ${c.label}`).join("\n")}`
    : "";

  // Extrai as primeiras 400 chars do system prompt como contexto do negócio
  const contextoNegocio = agentSystemPrompt
    ? `\n\nContexto do negócio (use para filtrar conversas irrelevantes):\n${agentSystemPrompt.slice(0, 400).replace(/\n+/g, " ").trim()}`
    : "";

  return `Você é um agente silencioso de CRM. Analise a conversa e decida se deve mover o lead no Kanban.

Lead: ${lead.name} | Etapa atual: ${colunaAtual?.label ?? lead.status} | Funil: ${funnel.name}${contextoNegocio}

Colunas disponíveis para mover_lead (use o id exato):
${listaPermitidas}${listaBloqueadas}

Regras:
- PRIORIDADE 1: Se a coluna tiver "Contexto", siga-o à risca — ele define exatamente quando mover
- PRIORIDADE 2: Se tiver "Gatilhos", mova quando a mensagem for semanticamente equivalente a um deles
- PRIORIDADE 3: Na ausência de contexto/gatilhos, mova quando houver indicação clara do estágio atual. Exemplos que DEVEM gerar movimentação:
    • Lead confirma data, horário ou aceita uma reunião/consulta → mover para coluna de reunião agendada
    • Lead demonstra interesse explícito no produto/serviço → mover para coluna de interessados
    • Lead solicita proposta, orçamento ou preço → mover para etapa de proposta
    • Lead diz que não tem interesse, que vai pensar, ou some por muito tempo → mover para perdidos
    • Lead confirma pagamento, envia comprovante ou diz que fechou → mover para coluna de clientes
- IMPORTANTE: Avalie a conversa INTEIRA, não apenas a última frase — se o lead confirmou reunião há algumas mensagens e depois disse "ok" ou "até lá", o estado ainda é "reunião confirmada"
- FILTRO DE NICHO (REGRA MAIS IMPORTANTE): Se a conversa for sobre assuntos pessoais ou de negócios/serviços COMPLETAMENTE DIFERENTES do contexto do negócio acima, NÃO tome nenhuma ação. Exemplo: se o negócio é de tráfego pago e o lead está falando sobre personal trainer, academia, alimentação ou outro serviço não relacionado → NÃO mova, NÃO atualize
- Em caso de dúvida entre mover ou não: SE a conversa for claramente sobre o negócio E mostrar sinal claro do estágio, MOVA
- NUNCA mova para colunas bloqueadas
- Não mova se o lead já está na coluna correta
- Use atualizar_lead para: (a) capturar o nome real do lead, (b) anotar contexto importante
- REGRA DO VALOR: preencha o campo 'valor' SOMENTE se AMBAS as condições forem verdadeiras:
    1. O Assistente (ou vendedor) propôs explicitamente um preço/valor na conversa
    2. O lead aceitou — disse algo como "ok", "fechado", "topo", "pode ser", "vamos nessa", "aceito", "confirmado", "tá bom", "feito"
  Se o lead apenas perguntou o preço, mencionou um número sem contexto, ou ainda não confirmou → NÃO preencha 'valor'
- CONFIANÇA: sempre informe o campo 'confianca' (0.0 a 1.0) ao chamar mover_lead. Abaixo de 0.75 a movimentação será bloqueada automaticamente. Use 0.9+ apenas quando a evidência for explícita e inequívoca. Dúvidas → use valor baixo.
- Se não houver nada a fazer, não chame nenhuma ferramenta
- Você NÃO responde ao usuário — apenas executa ações no CRM`;
}

async function runKanbanAgent(
  lastMessage: string,
  history: ChatMessage[],
  lead: Lead,
  funnel: Funnel,
  geminiApiKey: string,
  agentSystemPrompt?: string
): Promise<KanbanAction[]> {
  // ── CAMADA 5: Mínimo de mensagens ────────────────────────────────────────
  // Evita decisões prematuras com apenas 1 mensagem
  const totalMsgs = history.length + 1; // +1 pela lastMessage
  if (totalMsgs < 2) {
    console.log(`[kanban-agent/layer5] bloqueado — menos de 2 mensagens (total=${totalMsgs})`);
    return [];
  }

  const genAI = new GoogleGenerativeAI(geminiApiKey);
  const model = genAI.getGenerativeModel({
    model: "gemini-2.5-flash",
    systemInstruction: buildSystemPrompt(lead, funnel, agentSystemPrompt),
    tools: [
      {
        functionDeclarations: [
          {
            name: "mover_lead",
            description:
              "Move o lead para outra coluna do funil quando a conversa indicar mudança clara de estágio.",
            parameters: {
              type: SchemaType.OBJECT,
              properties: {
                coluna_id: {
                  type: SchemaType.STRING,
                  description: "ID da coluna de destino conforme listado no contexto",
                },
                motivo: {
                  type: SchemaType.STRING,
                  description: "Motivo resumido da mudança (ex: 'confirmou reunião', 'fechou negócio')",
                },
                confianca: {
                  type: SchemaType.NUMBER,
                  description: "Score de confiança de 0.0 a 1.0. Use 0.9+ quando a evidência for explícita e inequívoca (lead disse 'fechei', confirmou data/hora, etc.). Use 0.7-0.89 quando há forte indicação mas alguma ambiguidade. Use abaixo de 0.7 se houver dúvida — a movimentação será bloqueada automaticamente pelo sistema.",
                },
              },
              required: ["coluna_id", "motivo", "confianca"],
            },
          },
          {
            name: "atualizar_lead",
            description:
              "Atualiza dados do lead: nome real, notas relevantes da conversa e/ou valor monetário mencionado.",
            parameters: {
              type: SchemaType.OBJECT,
              properties: {
                nome: {
                  type: SchemaType.STRING,
                  description: "Nome real do lead (só preencha se ele se apresentou explicitamente)",
                },
                notas: {
                  type: SchemaType.STRING,
                  description: "Resumo do interesse, produto/serviço mencionado, objeções e próximos passos",
                },
                valor: {
                  type: SchemaType.NUMBER,
                  description: "Valor da venda aceito pelo lead. Preencha SOMENTE se: (1) o Assistente ou o vendedor propôs um valor/preço, E (2) o lead explicitamente aceitou (ex: 'ok', 'fechado', 'topo', 'pode ser', 'vamos nessa', 'aceito', 'confirmado'). NÃO preencha se o lead apenas mencionou um valor sem aceitar, ou se foi o lead quem sugeriu o preço.",
                },
              },
            },
          },
        ],
      },
    ],
    generationConfig: { maxOutputTokens: 2048 },
  });

  // Monta bloco de conversa recente (últimas 12 mensagens + última mensagem)
  // para análise holística — o agente vê o CONTEXTO completo, não só a última frase
  const recentHistory = history.slice(-12);
  const blocoConversa = recentHistory
    .map((m) => `[${m.role === "assistant" ? "Assistente" : "Lead"}]: ${m.content}`)
    .join("\n");
  const promptAnalise = blocoConversa
    ? `Conversa recente (analise TODO o bloco para determinar o estado atual do lead):\n${blocoConversa}\n\n[Lead] (última mensagem): ${lastMessage}\n\nCom base na conversa COMPLETA acima, execute as ações necessárias no CRM.`
    : `Primeira mensagem do lead: ${lastMessage}\n\nExecute as ações necessárias no CRM.`;

  console.log(`[kanban-agent/prompt] enviando ${recentHistory.length + 1} mensagens para Gemini`);

  try {
    const result = await model.generateContent(promptAnalise);
    const response = result.response;

    const actions: KanbanAction[] = [];
    const allParts = response.candidates?.flatMap((c) => c.content?.parts ?? []) ?? [];
    const fnCalls = allParts.filter((p) => p.functionCall).map((p) => p.functionCall!.name);
    const finishReason = response.candidates?.[0]?.finishReason ?? "?";
    const safetyRatings = response.candidates?.[0]?.safetyRatings?.map((r) => `${r.category}:${r.probability}`).join(",") ?? "";
    console.log(`[kanban-agent/gemini] finishReason=${finishReason} fnCalls=[${fnCalls.join(",")}] text="${(response.text?.() ?? "").slice(0, 150)}" safety=[${safetyRatings}]`);

    for (const candidate of response.candidates ?? []) {
      for (const part of candidate.content?.parts ?? []) {
        if (!part.functionCall) continue;

        if (part.functionCall.name === "mover_lead") {
          const args = part.functionCall.args as { coluna_id?: string; motivo?: string; confianca?: number };
          const colunaId = args.coluna_id ?? "";
          const confianca = typeof args.confianca === "number" ? args.confianca : 1;

          // ── CAMADA 2: Validação de args ──────────────────────────────────
          if (!colunaId || typeof colunaId !== "string") {
            console.log(`[kanban-agent/layer2] mover_lead rejeitado — coluna_id inválido: ${JSON.stringify(colunaId)}`);
            continue;
          }
          if (!args.motivo || typeof args.motivo !== "string" || args.motivo.trim().length < 3) {
            console.log(`[kanban-agent/layer2] mover_lead rejeitado — motivo ausente ou vazio`);
            continue;
          }

          // ── CAMADA 3: Whitelist de transições ────────────────────────────
          const colunaAtual = (funnel.columns ?? []).find((c) => c.id === lead.status);
          const whitelist = colunaAtual?.allowedTransitions;
          if (whitelist && whitelist.length > 0 && !whitelist.includes(colunaId)) {
            console.log(`[kanban-agent/layer3] mover_lead bloqueado — ${colunaId} não está na whitelist de ${lead.status}: [${whitelist.join(",")}]`);
            continue;
          }

          // ── CAMADA 4: Threshold de confiança (75%) ───────────────────────
          if (confianca < 0.75) {
            console.log(`[kanban-agent/layer4] mover_lead bloqueado — confiança ${confianca.toFixed(2)} < 0.75`);
            continue;
          }

          const colunaValida = (funnel.columns ?? []).find((c) => c.id === colunaId);
          if (colunaValida && !colunaValida.blockAutoMove && colunaId !== lead.status) {
            actions.push({ type: "mover_lead", colunaId, motivo: args.motivo ?? "" });
            console.log(`[kanban-agent/layers-ok] mover_lead aprovado → ${colunaId} (confiança=${confianca.toFixed(2)})`);
          } else {
            console.log(`[kanban-agent/gemini] mover_lead ignorado: colunaId=${colunaId} valida=${!!colunaValida} blockAutoMove=${colunaValida?.blockAutoMove} jaEsta=${colunaId === lead.status}`);
          }
        }

        if (part.functionCall.name === "atualizar_lead") {
          const args = part.functionCall.args as { nome?: string; notas?: string; valor?: number };
          if (args.nome || args.notas || typeof args.valor === "number") {
            actions.push({ type: "atualizar_lead", nome: args.nome, notas: args.notas, valor: args.valor });
          }
        }
      }
    }

    return actions;
  } catch (err) {
    console.error("[kanban-agent] Erro Gemini:", err);
    return [];
  }
}

/**
 * Classifica um lead com base em todo o histórico de conversa.
 * Usado pelo endpoint de classificação em lote.
 * Retorna true se o lead foi movido.
 */
export async function classifyLeadByHistory(
  history: ChatMessage[],
  lead: Lead,
  funnel: Funnel,
  geminiApiKey: string,
  client: { pixelId?: string; capiToken?: string } | null
): Promise<boolean> {
  if (history.length === 0) return false;

  // Para classificação em lote usamos toda a conversa como contexto
  const lastMessage = history[history.length - 1]?.content ?? "";
  const priorHistory = history.slice(0, -1);

  const actions = await runKanbanAgent(lastMessage, priorHistory, lead, funnel, geminiApiKey);
  if (actions.length === 0) return false;

  let moved = false;
  for (const action of actions) {
    if (action.type === "mover_lead") {
      const col = (funnel.columns ?? []).find((c) => c.id === action.colunaId);
      if (!col) continue;
      updateLead(lead.id, { status: col.id });
      console.log(`[kanban-agent/classify] Lead ${lead.name} → ${col.label} (${action.motivo})`);
      if (col.metaEvent && client?.pixelId) {
        sendCapiEvent({
          pixelId: client.pixelId,
          capiToken: client.capiToken,
          eventName: col.metaEvent,
          phone: lead.phone,
          email: lead.email ?? undefined,
          externalId: lead.id,
          value: lead.value ?? undefined,
        }).catch(() => {});
      }
      moved = true;
    }
    if (action.type === "atualizar_lead") {
      const patch: Record<string, string> = {};
      if (action.nome) patch.name = action.nome;
      if (action.notas) patch.notes = action.notas;
      if (Object.keys(patch).length) updateLead(lead.id, patch);
    }
  }
  return moved;
}

/**
 * Ponto de entrada principal — chamado pelo webhook após cada mensagem.
 * Fire-and-forget: não bloqueia a resposta ao usuário.
 */
export async function processKanbanActions(
  lastMessage: string,
  history: ChatMessage[],
  clientId: string,
  phone: string
): Promise<void> {
  const client = getClientById(clientId);
  // Agente desabilitado explicitamente pelo gestor
  if (client?.kanbanAgentEnabled === false) {
    console.log(`[kanban-agent] desabilitado para client=${clientId}`);
    return;
  }

  const geminiApiKey = getGeminiApiKey(client?.agentConfig?.geminiApiKey ?? undefined);
  if (!geminiApiKey) {
    console.error(`[kanban-agent] GEMINI_API_KEY não configurada — client=${clientId}`);
    return;
  }

  const lead = getLeadByPhone(clientId, phone);
  if (!lead) {
    console.log(`[kanban-agent] lead não encontrado client=${clientId} phone=${phone}`);
    return;
  }

  const funnel = getFunnelById(lead.funnelId);
  if (!funnel) {
    console.log(`[kanban-agent] funil não encontrado funnelId=${lead.funnelId}`);
    return;
  }

  const agentSystemPrompt = client?.agentConfig?.systemPrompt ?? undefined;
  console.log(`[kanban-agent] iniciando — lead=${lead.name} status=${lead.status} msg="${lastMessage.slice(0, 80)}"`)

  const actions = await runKanbanAgent(lastMessage, history, lead, funnel, geminiApiKey, agentSystemPrompt);

  console.log(`[kanban-agent] Gemini retornou ${actions.length} ação(ões):`, JSON.stringify(actions));

  if (actions.length === 0) return;

  for (const action of actions) {
    if (action.type === "mover_lead") {
      const col = (funnel.columns ?? []).find((c) => c.id === action.colunaId);
      if (!col) {
        console.log(`[kanban-agent] coluna não encontrada: ${action.colunaId}`);
        continue;
      }

      updateLead(lead.id, { status: col.id });
      console.log(`[kanban-agent] Lead ${lead.name} → ${col.label} (${action.motivo})`);

      // Dispara CAPI se a coluna tiver evento configurado
      if (col.metaEvent && client?.pixelId) {
        sendCapiEvent({
          pixelId: client.pixelId,
          capiToken: client.capiToken,
          eventName: col.metaEvent,
          phone: lead.phone,
          email: lead.email ?? undefined,
          externalId: lead.id,
          value: lead.value ?? undefined,
        }).catch(() => {});
      }
    }

    if (action.type === "atualizar_lead") {
      const patch: Record<string, unknown> = {};
      if (action.nome) patch.name = action.nome;
      if (action.notas) patch.notes = action.notas;
      if (typeof action.valor === "number" && action.valor > 0) patch.value = action.valor;
      if (Object.keys(patch).length) {
        updateLead(lead.id, patch);
        console.log(`[kanban-agent] Lead ${lead.id} atualizado:`, patch);
      }
    }
  }
}
