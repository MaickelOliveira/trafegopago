import { GoogleGenerativeAI, SchemaType, type Tool, type FunctionDeclaration } from "@google/generative-ai";
import { getClientById, type AgentMedia } from "./clients";
import { getGeminiApiKey } from "./whatsapp-send";
import { scheduleFollowUp, cancelFollowUpsForPhone } from "./followups";
import { createEvent, listFreeSlots, cancelEvent, listEvents, updateEvent } from "./google-calendar";
import { getHistory } from "./conversations";
import type { ChatMessage } from "./conversations";

export type GeminiAction =
  | { type: "agendamento_criado"; eventId: string; link: string; titulo: string; dataHora: string }
  | { type: "followup_agendado"; horas: number; mensagem: string }
  | { type: "lembrete_agendado"; dataHora: string; mensagem: string }
  | { type: "resumo_solicitado"; motivo: string; phone: string }
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
    name: "listar_agendamentos",
    description: "Lista os compromissos agendados no Google Calendar em um período. Use SEMPRE antes de cancelar ou reagendar para obter o ID do evento.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        data_inicio: { type: SchemaType.STRING, description: "Data de início da busca no formato YYYY-MM-DD" },
        data_fim:    { type: SchemaType.STRING, description: "Data de fim da busca no formato YYYY-MM-DD (opcional, padrão: 30 dias à frente)" },
      },
      required: ["data_inicio"],
    },
  },
  {
    name: "cancelar_agendamento",
    description: "Cancela um compromisso do Google Calendar pelo ID do evento. Use listar_agendamentos primeiro para obter o event_id.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        event_id: { type: SchemaType.STRING, description: "ID do evento no Google Calendar (obtido via listar_agendamentos)" },
      },
      required: ["event_id"],
    },
  },
  {
    name: "reagendar_agendamento",
    description: "Reagenda (atualiza data/hora) de um compromisso existente. Use listar_agendamentos primeiro para obter o event_id.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        event_id:        { type: SchemaType.STRING, description: "ID do evento no Google Calendar (obtido via listar_agendamentos)" },
        data:            { type: SchemaType.STRING, description: "Nova data no formato YYYY-MM-DD" },
        hora_inicio:     { type: SchemaType.STRING, description: "Novo horário de início no formato HH:MM" },
        duracao_minutos: { type: SchemaType.NUMBER, description: "Duração em minutos (padrão 60)" },
      },
      required: ["event_id", "data", "hora_inicio"],
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

function buildSystemPrompt(clientName: string, customPrompt?: string, mediaLibrary?: AgentMedia[]): string {
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

  // Instrução de mídias — só aparece se houver mídias com nome configuradas
  const namedMedia = (mediaLibrary ?? []).filter((m) => m.name?.trim());
  const mediaPart = namedMedia.length > 0
    ? `\n\nMídias disponíveis para enviar ao lead:\n${namedMedia.map((m) => {
        const tipo = m.type === "image" ? "imagem" : m.type === "video" ? "vídeo" : "documento";
        const desc = m.caption ? ` — "${m.caption}"` : "";
        return `• [${m.name}]: ${tipo}${desc}`;
      }).join("\n")}\n\nPara enviar uma mídia, inclua o marcador no texto da resposta:\n  [MIDIA:nome-da-midia]\nExemplo: "Aqui está nosso catálogo! [MIDIA:catalogo-produtos]"\nO arquivo será enviado automaticamente no lugar do marcador. Só envie mídia quando fizer sentido no contexto da conversa.`
    : "";

  if (customPrompt?.trim()) {
    return `${customPrompt.trim()}\n\n--- Capacidades do sistema ---\n${base}${mediaPart}`;
  }
  return `${base}${mediaPart}`;
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
  const mediaLibrary = client.agentConfig.mediaLibrary;
  const sysPrompt = buildSystemPrompt(client.name, client.agentConfig.systemPrompt, mediaLibrary);

  // Tenta modelos em ordem de preferência
  const modelsToTry = [
    "gemini-2.5-pro-preview-05-06",
    "gemini-2.5-pro",
    "gemini-2.5-pro-exp-03-25",
    "gemini-1.5-pro",
  ];

  let model;
  let usedModel = modelsToTry[0];
  for (const modelId of modelsToTry) {
    try {
      const m = genAI.getGenerativeModel({
        model: modelId,
        systemInstruction: sysPrompt,
        tools: TOOLS,
      });
      // Teste rápido para verificar se o modelo existe
      await m.generateContent("test");
      model = m;
      usedModel = modelId;
      break;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("not found") || msg.includes("404")) continue;
      // Outro erro — usa este modelo mesmo assim
      model = genAI.getGenerativeModel({
        model: modelId,
        systemInstruction: sysPrompt,
        tools: TOOLS,
      });
      usedModel = modelId;
      break;
    }
  }

  if (!model) {
    console.error("[gemini-agent] Nenhum modelo disponível para a chave fornecida");
    return { text: "", actions: [] };
  }

  console.log(`[gemini-agent] Usando modelo: ${usedModel}`);

  // Converte histórico para formato Gemini
  // Gemini exige que o histórico comece com 'user' — remove mensagens iniciais do assistente
  const rawHistory = history.slice(-10).map((m) => ({
    role: m.role === "user" ? "user" : "model",
    parts: [{ text: m.content }],
  }));
  const firstUserIdx = rawHistory.findIndex((m) => m.role === "user");
  const geminiHistory = firstUserIdx > 0 ? rawHistory.slice(firstUserIdx) : rawHistory;

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

            else if (call.name === "listar_agendamentos") {
              if (client.agentConfig?.googleRefreshToken && client.agentConfig.googleCalendarId) {
                const dataInicio = args.data_inicio as string;
                const dataFim = (args.data_fim as string | undefined);
                const timeMin = new Date(`${dataInicio}T00:00:00`).toISOString();
                const timeMax = dataFim
                  ? new Date(`${dataFim}T23:59:59`).toISOString()
                  : new Date(new Date(`${dataInicio}T00:00:00`).getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();
                const events = await listEvents(
                  client.agentConfig.googleRefreshToken,
                  client.agentConfig.googleCalendarId,
                  timeMin,
                  timeMax
                );
                result = events.length > 0
                  ? { agendamentos: events.map((e) => ({ id: e.id, titulo: e.title, inicio: e.start, fim: e.end })) }
                  : { agendamentos: [], mensagem: "Nenhum agendamento encontrado no período" };
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
              } else {
                result = { error: "Google Calendar não conectado" };
              }
            }

            else if (call.name === "reagendar_agendamento") {
              if (client.agentConfig?.googleRefreshToken && client.agentConfig.googleCalendarId) {
                const data = args.data as string;
                const horaInicio = args.hora_inicio as string;
                const duracao = (args.duracao_minutos as number) || 60;
                const startISO = new Date(`${data}T${horaInicio}:00`).toISOString();
                const endISO = new Date(new Date(`${data}T${horaInicio}:00`).getTime() + duracao * 60000).toISOString();
                await updateEvent(
                  client.agentConfig.googleRefreshToken,
                  client.agentConfig.googleCalendarId,
                  args.event_id as string,
                  { startDateTime: startISO, endDateTime: endISO }
                );
                result = { ok: true };
                actions.push({ type: "agendamento_criado", eventId: args.event_id as string, link: "", titulo: "", dataHora: `${data} às ${horaInicio}` });
              } else {
                result = { error: "Google Calendar não conectado" };
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
              const motivo = (args.motivo as string) || "Solicitado pela IA";
              actions.push({ type: "resumo_solicitado", motivo, phone });
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
