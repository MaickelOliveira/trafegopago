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
  | { type: "atualizar_lead"; nome?: string; notas?: string };

function buildSystemPrompt(lead: Lead, funnel: Funnel): string {
  const columns = funnel.columns ?? [];
  const colunaAtual = columns.find((c) => c.id === lead.status);

  // Colunas que o agente PODE mover (blockAutoMove !== true)
  const colunasPermitidas = columns.filter((c) => !c.blockAutoMove);
  const colunasBloqueadas = columns.filter((c) => c.blockAutoMove);

  const listaPermitidas = colunasPermitidas
    .map((c) => {
      const frases = c.triggerPhrases?.length
        ? ` [gatilhos: ${c.triggerPhrases.map((f) => `"${f}"`).join(", ")}]`
        : "";
      return `• ${c.id} → ${c.label}${c.id === lead.status ? " (atual)" : ""}${frases}`;
    })
    .join("\n");

  const listaBloqueadas = colunasBloqueadas.length > 0
    ? `\nColunas BLOQUEADAS para movimentação automática (preenchidas manualmente):\n${colunasBloqueadas.map((c) => `• ${c.label}`).join("\n")}`
    : "";

  return `Você é um agente silencioso de CRM. Analise a última mensagem do lead e decida se deve atualizar o Kanban.

Lead: ${lead.name} | Etapa atual: ${colunaAtual?.label ?? lead.status} | Funil: ${funnel.name}

Colunas disponíveis para mover_lead (use o id):
${listaPermitidas}${listaBloqueadas}

Regras:
- Use mover_lead quando a mensagem contiver (ou for semanticamente equivalente a) um dos gatilhos configurados para uma coluna
- Use mover_lead também quando houver mudança CLARA de estágio, mesmo sem gatilho exato
- NUNCA mova para colunas bloqueadas — essas são preenchidas manualmente pelo gestor
- Não mova se o lead já está na coluna correta
- Use atualizar_lead para capturar nome real ou resumir contexto relevante
- Se não houver nada a fazer, não use nenhuma ferramenta
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
    model: "gemini-2.0-flash",
    systemInstruction: buildSystemPrompt(lead, funnel),
    tools: [
      {
        functionDeclarations: [
          {
            name: "mover_lead",
            description:
              "Move o lead para outra coluna do funil quando ele demonstrar mudança clara de estágio na conversa (ex: demonstrou interesse, pediu orçamento, confirmou compra, disse que não tem interesse).",
            parameters: {
              type: SchemaType.OBJECT,
              properties: {
                coluna_id: {
                  type: SchemaType.STRING,
                  description: "ID da coluna de destino conforme listado no contexto",
                },
                motivo: {
                  type: SchemaType.STRING,
                  description: "Motivo resumido da mudança (ex: 'pediu orçamento', 'confirmou interesse')",
                },
              },
              required: ["coluna_id", "motivo"],
            },
          },
          {
            name: "atualizar_lead",
            description:
              "Atualiza dados do lead captados na conversa: nome real quando ele se apresentar, e notas com contexto importante (produto de interesse, objeções, situação).",
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
              },
            },
          },
        ],
      },
    ],
    generationConfig: { maxOutputTokens: 256 },
  });

  // Monta histórico resumido (últimas 8 mensagens) + última mensagem do lead
  const recentHistory = history.slice(-8);
  const geminiHistory = recentHistory.map((m) => ({
    role: m.role === "assistant" ? ("model" as const) : ("user" as const),
    parts: [{ text: m.content }],
  }));

  try {
    const chat = model.startChat({ history: geminiHistory });
    const result = await chat.sendMessage(lastMessage);
    const response = result.response;

    const actions: KanbanAction[] = [];
    const allParts = response.candidates?.flatMap((c) => c.content?.parts ?? []) ?? [];
    const fnCalls = allParts.filter((p) => p.functionCall).map((p) => p.functionCall!.name);
    console.log(`[kanban-agent/gemini] candidatos=${response.candidates?.length ?? 0} fnCalls=[${fnCalls.join(",")}] text="${(response.text?.() ?? "").slice(0, 100)}"`);

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
          const args = part.functionCall.args as { nome?: string; notas?: string };
          if (args.nome || args.notas) {
            actions.push({ type: "atualizar_lead", nome: args.nome, notas: args.notas });
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
      const patch: Record<string, string> = {};
      if (action.nome) patch.name = action.nome;
      if (action.notas) patch.notes = action.notas;
      if (Object.keys(patch).length) {
        updateLead(lead.id, patch);
        console.log(`[kanban-agent] Lead ${lead.id} atualizado:`, patch);
      }
    }
  }
}
