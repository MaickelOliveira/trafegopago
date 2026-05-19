import { GoogleGenerativeAI, SchemaType, type Tool, type FunctionDeclaration } from "@google/generative-ai";
import { getClientById } from "./clients";
import { getGeminiApiKey } from "./whatsapp-send";
import { scheduleFollowUp, cancelFollowUpsForPhone } from "./followups";
import { createEvent, listFreeSlots, cancelEvent } from "./google-calendar";
import { getHistory } from "./conversations";
import type { ChatMessage } from "./conversations";

export type GeminiAction =
  | { type: "agendamento_criado"; eventId: string; link: string; titulo: string; dataHora: string }
  | { type: "followup_agendado"; horas: number; mensagem: string }
  | { type: "lembrete_agendado"; dataHora: string; mensagem: string }
  | { type: "resumo_solicitado" }
  | { type: "agendamento_cancelado"; eventId: string };

const TOOL_DECLARATIONS: FunctionDeclaration[] = [
  {
    name: "agendar_compromisso",
    description: "Cria um compromisso no Google Calendar do cliente. Use quando o lead quiser marcar uma consulta, reunião ou atendimento.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        titulo:           { type: SchemaType.STRING, description: "Título do compromisso" },
        data:             { type: SchemaType.STRING, description: "Data no formato YYYY-MM-DD, ex: 2026-05-20" },
        hora_inicio:      { type: SchemaType.STRING, description: "Hora de início no formato HH:MM, ex: 14:00" },
        duracao_minutos:  { type: SchemaType.NUMBER, description: "Duração em minutos (padrão 60)" },
        descricao:        { type: SchemaType.STRING, description: "Detalhes adicionais do compromisso" },
      },
      required: ["titulo", "data", "hora_inicio"],
    },
  },
  {
    name: "listar_horarios_disponiveis",
    description: "Lista os horários livres no Google Calendar para uma data específica.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        data: { type: SchemaType.STRING, description: "Data no formato YYYY-MM-DD" },
      },
      required: ["data"],
    },
  },
  {
    name: "cancelar_agendamento",
    description: "Cancela um compromisso do Google Calendar pelo ID do evento.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        event_id: { type: SchemaType.STRING, description: "ID do evento no Google Calendar" },
      },
      required: ["event_id"],
    },
  },
  {
    name: "agendar_followup",
    description: "Agenda um follow-up automático para ser enviado após X horas sem resposta.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        mensagem: { type: SchemaType.STRING, description: "Mensagem do follow-up" },
        horas:    { type: SchemaType.NUMBER, description: "Horas a aguardar antes de enviar (padrão: 24)" },
      },
      required: ["mensagem"],
    },
  },
  {
    name: "enviar_resumo",
    description: "Envia um resumo da conversa para o número configurado pelo gestor.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        motivo: { type: SchemaType.STRING, description: "Motivo do resumo (ex: lead quente, pediu orçamento)" },
      },
      required: ["motivo"],
    },
  },
];

const TOOLS: Tool[] = [{ functionDeclarations: TOOL_DECLARATIONS }];

function buildSystemPrompt(clientName: string, customPrompt?: string): string {
  const today = new Date().toLocaleDateString("pt-BR", {
    weekday: "long", year: "numeric", month: "long", day: "numeric",
  });

  const base = `Você é um assistente de WhatsApp para ${clientName}.
Data atual: ${today}

Você pode:
- Verificar horários disponíveis e agendar compromissos no Google Calendar
- Registrar follow-ups automáticos
- Enviar resumos da conversa para o gestor

Regras:
- Sempre responda em português, mensagens curtas e amigáveis
- Ao agendar, confirme: data, hora e nome do lead
- Use listar_horarios_disponiveis antes de agendar para verificar disponibilidade
- Ao receber mensagem nova, cancele follow-ups pendentes deste contato`;

  if (customPrompt?.trim()) {
    return `${customPrompt.trim()}\n\n--- Capacidades do sistema ---\n${base}`;
  }
  return base;
}

export async function runGeminiAgent(
  userMessage: string,
  history: ChatMessage[],
  clientId: string,
  phone: string
): Promise<{ text: string; actions: GeminiAction[] }> {
  const client = getClientById(clientId);
  if (!client?.agentConfig?.enabled) return { text: "", actions: [] };

  const apiKey = getGeminiApiKey(client.agentConfig.geminiApiKey);
  if (!apiKey) return { text: "", actions: [] };

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: "gemini-2.5-pro",
    systemInstruction: buildSystemPrompt(client.name, client.agentConfig.systemPrompt),
    tools: TOOLS,
  });

  // Converte histórico para formato Gemini
  const geminiHistory = history.slice(-10).map((m) => ({
    role: m.role === "user" ? "user" : "model",
    parts: [{ text: m.content }],
  }));

  const chat = model.startChat({ history: geminiHistory });

  const actions: GeminiAction[] = [];
  let finalText = "";

  try {
    let response = await chat.sendMessage(userMessage);
    let candidate = response.response;

    // Loop para processar tool calls
    while (true) {
      const parts = candidate.candidates?.[0]?.content?.parts ?? [];
      const toolCalls = parts.filter((p) => p.functionCall);

      if (toolCalls.length === 0) {
        finalText = candidate.text();
        break;
      }

      // Executa cada tool call
      const toolResults = await Promise.all(
        toolCalls.map(async (part) => {
          const call = part.functionCall!;
          const args = call.args as Record<string, unknown>;
          let result: unknown = { ok: true };

          try {
            if (call.name === "listar_horarios_disponiveis") {
              if (client.agentConfig?.googleRefreshToken && client.agentConfig.googleCalendarId) {
                const slots = await listFreeSlots(
                  client.agentConfig.googleRefreshToken,
                  client.agentConfig.googleCalendarId,
                  args.data as string
                );
                result = { slots: slots.length > 0 ? slots : "Nenhum horário disponível" };
              } else {
                result = { error: "Google Calendar não conectado" };
              }
            }

            else if (call.name === "agendar_compromisso") {
              if (client.agentConfig?.googleRefreshToken && client.agentConfig.googleCalendarId) {
                const data = args.data as string;
                const horaInicio = args.hora_inicio as string;
                const duracao = (args.duracao_minutos as number) || 60;
                const startISO = new Date(`${data}T${horaInicio}:00`).toISOString();
                const endISO = new Date(new Date(`${data}T${horaInicio}:00`).getTime() + duracao * 60000).toISOString();

                const { eventId, link } = await createEvent(
                  client.agentConfig.googleRefreshToken,
                  client.agentConfig.googleCalendarId,
                  {
                    title: args.titulo as string,
                    description: (args.descricao as string) ?? `Lead: ${phone}`,
                    startDateTime: startISO,
                    endDateTime: endISO,
                  }
                );
                result = { eventId, link, ok: true };
                actions.push({
                  type: "agendamento_criado",
                  eventId,
                  link,
                  titulo: args.titulo as string,
                  dataHora: `${data} às ${horaInicio}`,
                });
              } else {
                result = { error: "Google Calendar não conectado" };
              }
            }

            else if (call.name === "cancelar_agendamento") {
              if (client.agentConfig?.googleRefreshToken && client.agentConfig.googleCalendarId) {
                await cancelEvent(
                  client.agentConfig.googleRefreshToken,
                  client.agentConfig.googleCalendarId,
                  args.event_id as string
                );
                result = { ok: true };
                actions.push({ type: "agendamento_cancelado", eventId: args.event_id as string });
              }
            }

            else if (call.name === "agendar_followup") {
              if (client.agentConfig?.followUpEnabled) {
                const horas = (args.horas as number) || 24;
                const scheduledAt = new Date(Date.now() + horas * 3600000).toISOString();
                scheduleFollowUp({
                  clientId,
                  phone,
                  scheduledAt,
                  message: args.mensagem as string,
                  type: "followup",
                });
                result = { ok: true, scheduledAt };
                actions.push({ type: "followup_agendado", horas, mensagem: args.mensagem as string });
              } else {
                result = { error: "Follow-up desabilitado para este cliente" };
              }
            }

            else if (call.name === "enviar_resumo") {
              actions.push({ type: "resumo_solicitado" });
              result = { ok: true };
            }
          } catch (e) {
            console.error(`[gemini-agent] Tool ${call.name} error:`, e);
            result = { error: String(e) };
          }

          return {
            functionResponse: {
              name: call.name,
              response: result,
            },
          };
        })
      );

      // Envia resultados de volta para o modelo
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      response = await chat.sendMessage(toolResults as any);
      candidate = response.response;
    }

    // Cancela follow-ups pendentes quando lead responde
    cancelFollowUpsForPhone(clientId, phone);

  } catch (err) {
    console.error("[gemini-agent] Error:", err);
    return { text: "Desculpe, tive um problema técnico. Pode repetir?", actions: [] };
  }

  return { text: finalText, actions };
}
