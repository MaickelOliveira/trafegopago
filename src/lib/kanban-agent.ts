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

function buildSystemPrompt(lead: Lead, funnel: Funnel): string {
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
      const detalhe = linhas.length ? "\n" + linhas.join("\n") : "";
      return `• ${c.id} → ${c.label}${c.id === lead.status ? " (ETAPA ATUAL)" : ""}${detalhe}`;
    })
    .join("\n");

  const listaBloqueadas = colunasBloqueadas.length > 0
    ? `\nColunas BLOQUEADAS para movimentação automática (preenchidas manualmente):\n${colunasBloqueadas.map((c) => `• ${c.label}`).join("\n")}`
    : "";

  return `Você é um agente silencioso de CRM. Analise a conversa e decida se deve mover o lead no Kanban.

Lead: ${lead.name} | Etapa atual: ${colunaAtual?.label ?? lead.status} | Funil: ${funnel.name}

Colunas disponíveis para mover_lead (use o id exato):
${listaPermitidas}${listaBloqueadas}

Regras:
- PRIORIDADE 1: Se a coluna tiver "Contexto", siga-o à risca — ele define exatamente quando mover
- PRIORIDADE 2: Se tiver "Gatilhos", mova quando a mensagem for semanticamente equivalente a um deles
- PRIORIDADE 3: Na ausência de contexto/gatilhos, mova quando houver mudança CLARA e inequívoca de estágio
- IMPORTANTE: Avalie a conversa INTEIRA, não apenas a última frase — se o lead confirmou reunião 2 mensagens atrás e depois disse "ok", o estado ainda é "reunião confirmada"
- NUNCA mova para colunas bloqueadas
- Não mova se o lead já está na coluna correta
- Use atualizar_lead para: (a) capturar o nome real do lead, (b) anotar contexto importante, (c) registrar qualquer valor monetário mencionado (preço, investimento, orçamento)
- Se não houver nada a fazer, não chame nenhuma ferramenta
- Você NÃO responde ao usuário — apenas executa ações no CRM`;
}

async function runKanbanAgent(
  lastMessage: string,
  history: ChatMessage[],
  lead: Lead,
  funnel: Funnel,
  geminiApiKey: string
): Promise<KanbanAction[]> {
  const genAI = new GoogleGenerativeAI(geminiApiKey);
  const model = genAI.getGenerativeModel({
    model: "gemini-2.5-flash",
    systemInstruction: buildSystemPrompt(lead, funnel),
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
              },
              required: ["coluna_id", "motivo"],
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
                  description: "Valor monetário mencionado na conversa (ex: 500 para R$ 500). Só preencha se um valor numérico foi claramente mencionado.",
                },
              },
            },
          },
        ],
      },
    ],
    generationConfig: { maxOutputTokens: 512 },
  });

  // Monta bloco de conversa recente (últimas 6 mensagens + última mensagem)
  // para análise holística — o agente vê o CONTEXTO completo, não só a última frase
  const recentHistory = history.slice(-6);
  const blocoConversa = recentHistory
    .map((m) => `[${m.role === "assistant" ? "Assistente" : "Lead"}]: ${m.content}`)
    .join("\n");
  const promptAnalise = blocoConversa
    ? `Conversa recente (analise TODO o bloco para determinar o estado atual do lead):\n${blocoConversa}\n\n[Lead] (última mensagem): ${lastMessage}\n\nCom base na conversa COMPLETA acima, execute as ações necessárias no CRM.`
    : `Primeira mensagem do lead: ${lastMessage}\n\nExecute as ações necessárias no CRM.`;

  try {
    const result = await model.generateContent(promptAnalise);
    const response = result.response;

    const actions: KanbanAction[] = [];
    const allParts = response.candidates?.flatMap((c) => c.content?.parts ?? []) ?? [];
    const fnCalls = allParts.filter((p) => p.functionCall).map((p) => p.functionCall!.name);
    console.log(`[kanban-agent/gemini] fnCalls=[${fnCalls.join(",")}] text="${(response.text?.() ?? "").slice(0, 100)}"`);

    for (const candidate of response.candidates ?? []) {
      for (const part of candidate.content?.parts ?? []) {
        if (!part.functionCall) continue;

        if (part.functionCall.name === "mover_lead") {
          const args = part.functionCall.args as { coluna_id?: string; motivo?: string };
          const colunaId = args.coluna_id ?? "";
          const colunaValida = (funnel.columns ?? []).find((c) => c.id === colunaId);
          if (colunaValida && !colunaValida.blockAutoMove && colunaId !== lead.status) {
            actions.push({ type: "mover_lead", colunaId, motivo: args.motivo ?? "" });
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

  console.log(`[kanban-agent] iniciando — lead=${lead.name} status=${lead.status} msg="${lastMessage.slice(0, 80)}"`);

  const actions = await runKanbanAgent(lastMessage, history, lead, funnel, geminiApiKey);

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
