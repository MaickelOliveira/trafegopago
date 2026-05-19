/**
 * Agente silencioso de CRM — roda após cada mensagem do WhatsApp,
 * analisa a conversa e atualiza o Kanban automaticamente.
 * Não interfere com o agente de atendimento existente.
 */

import Anthropic from "@anthropic-ai/sdk";
import { getConfig, getClientById } from "./clients";
import { updateLead, getLeadByPhone } from "./leads";
import { getFunnelById } from "./funnels";
import { sendCapiEvent } from "./meta-capi";
import type { ChatMessage } from "./conversations";
import type { Lead } from "./leads";
import type { Funnel } from "./funnels";

type KanbanAction =
  | { type: "mover_lead"; colunaId: string; motivo: string }
  | { type: "atualizar_lead"; nome?: string; notas?: string };

const TOOLS: Anthropic.Tool[] = [
  {
    name: "mover_lead",
    description: "Move o lead para outra coluna do funil quando ele demonstrar mudança clara de estágio na conversa (ex: demonstrou interesse, pediu orçamento, confirmou compra, disse que não tem interesse).",
    input_schema: {
      type: "object" as const,
      properties: {
        coluna_id: {
          type: "string",
          description: "ID da coluna de destino conforme listado no contexto",
        },
        motivo: {
          type: "string",
          description: "Motivo resumido da mudança (ex: 'pediu orçamento', 'confirmou interesse')",
        },
      },
      required: ["coluna_id", "motivo"],
    },
  },
  {
    name: "atualizar_lead",
    description: "Atualiza dados do lead captados na conversa: nome real quando ele se apresentar, e notas com contexto importante (produto de interesse, objeções, situação).",
    input_schema: {
      type: "object" as const,
      properties: {
        nome: {
          type: "string",
          description: "Nome real do lead (só preencha se ele se apresentou explicitamente)",
        },
        notas: {
          type: "string",
          description: "Resumo do interesse, produto/serviço mencionado, objeções e próximos passos",
        },
      },
    },
  },
];

function buildSystemPrompt(lead: Lead, funnel: Funnel): string {
  const colunaAtual = funnel.columns.find((c) => c.id === lead.status);

  // Colunas que o agente PODE mover (blockAutoMove !== true)
  const colunasPermitidas = funnel.columns.filter((c) => !c.blockAutoMove);
  const colunasBloqueadas = funnel.columns.filter((c) => c.blockAutoMove);

  const listaPermitidas = colunasPermitidas
    .map((c) => `• ${c.id} → ${c.label}${c.id === lead.status ? " (atual)" : ""}`)
    .join("\n");

  const listaBloqueadas = colunasBloqueadas.length > 0
    ? `\nColunas BLOQUEADAS para movimentação automática (preenchidas manualmente):\n${colunasBloqueadas.map((c) => `• ${c.label}`).join("\n")}`
    : "";

  return `Você é um agente silencioso de CRM. Analise a última mensagem do lead e decida se deve atualizar o Kanban.

Lead: ${lead.name} | Etapa atual: ${colunaAtual?.label ?? lead.status} | Funil: ${funnel.name}

Colunas disponíveis para mover_lead (use o id):
${listaPermitidas}${listaBloqueadas}

Regras:
- Use mover_lead APENAS quando houver mudança CLARA e EXPLÍCITA de estágio
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
  funnel: Funnel
): Promise<KanbanAction[]> {
  const config = getConfig();
  if (!config.anthropicApiKey) return [];

  const ai = new Anthropic({ apiKey: config.anthropicApiKey });

  // Monta histórico resumido (últimas 6 mensagens) + última mensagem do lead
  const recentHistory = history.slice(-6);
  const messages: Anthropic.MessageParam[] = [
    ...recentHistory.map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
    { role: "user", content: lastMessage },
  ];

  try {
    const response = await ai.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 256,
      system: buildSystemPrompt(lead, funnel),
      tools: TOOLS,
      tool_choice: { type: "auto" },
      messages,
    });

    const actions: KanbanAction[] = [];

    for (const block of response.content) {
      if (block.type !== "tool_use") continue;

      if (block.name === "mover_lead") {
        const input = block.input as { coluna_id: string; motivo: string };
        // Valida que a coluna existe, não está bloqueada e é diferente da atual
        const colunaValida = funnel.columns.find((c) => c.id === input.coluna_id);
        if (colunaValida && !colunaValida.blockAutoMove && input.coluna_id !== lead.status) {
          actions.push({ type: "mover_lead", colunaId: input.coluna_id, motivo: input.motivo });
        }
      }

      if (block.name === "atualizar_lead") {
        const input = block.input as { nome?: string; notas?: string };
        if (input.nome || input.notas) {
          actions.push({ type: "atualizar_lead", nome: input.nome, notas: input.notas });
        }
      }
    }

    return actions;
  } catch (err) {
    console.error("[kanban-agent] Erro:", err);
    return [];
  }
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
  if (client?.kanbanAgentEnabled === false) return;

  const lead = getLeadByPhone(clientId, phone);
  if (!lead) return;

  const funnel = getFunnelById(lead.funnelId);
  if (!funnel) return;

  const actions = await runKanbanAgent(lastMessage, history, lead, funnel);
  if (actions.length === 0) return;

  for (const action of actions) {
    if (action.type === "mover_lead") {
      const col = funnel.columns.find((c) => c.id === action.colunaId);
      if (!col) continue;

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
