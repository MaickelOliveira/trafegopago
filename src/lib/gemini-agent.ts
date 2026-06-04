import { GoogleGenerativeAI, SchemaType, type Tool, type FunctionDeclaration, type Part } from "@google/generative-ai";
import { getClientById, getAgentConfigForConnection, type AgentMedia, type KnowledgeBaseDoc } from "./clients";
import { getGeminiApiKey } from "./whatsapp-send";
import { scheduleFollowUp } from "./followups";
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

function sanitizeForWhatsApp(text: string): string {
  let result = text
    // 1. Remove blocos de código e backticks
    .replace(/```[\s\S]*?```/g, "")
    .replace(/`([^`]+)`/g, "$1")
    // 2. Remove linhas divisórias markdown
    .replace(/^[-_]{3,}$/gm, "")
    // 3. Converte **texto** → *texto* — permite newlines dentro do bloco bold
    .replace(/\*\*([^*]+)\*\*/g, "*$1*")
    // 4. Catch-all: qualquer ** restante vira * (cobre **N. Title:** multi-linha)
    .replace(/\*\*/g, "*")
    // 5. Converte ## Título → *TÍTULO*
    .replace(/^#{1,6}\s+(.+)$/gm, (_, t) => `*${t.trim().toUpperCase()}*`)
    // 6. Converte "- item" no início de linha → "• item"
    .replace(/^-\s+/gm, "• ")
    // 7. CRÍTICO: cada bullet • em sua própria linha
    //    Usa [ \t]* para NÃO absorver newlines já existentes
    .replace(/([^\n])[ \t]*•[ \t]*/g, "$1\n• ")
    // 8. Bullets nunca devem ter linha em branco entre eles (AI às vezes insere \n\n entre bullets)
    .replace(/\n\n(•)/g, "\n$1")
    // 9. Garante \n\n antes de itens numerados: *1. *2. ou 1. 2. no meio do texto
    .replace(/\n(\*?\d+[\.\)]\s)/g, "\n\n$1")         // 1 newline → 2
    .replace(/([^\n])(\*?\d+[\.\)]\s)/g, "$1\n\n$2")  // 0 newlines → 2
    // 10. Remove asteriscos solitários em parágrafos próprios (resíduo de ** multi-linha)
    //     ex: "\n\n*\n\n" → "\n\n" e "* solt\n\nN." → "N."
    .replace(/\n\n\*\n\n(\d+[\.\)]\s)/g, "\n\n$1")  // *\n\nN. → N.
    .replace(/\n\n\*\n\n/g, "\n\n")                  // *\n\n solto no meio
    .replace(/^\*\n\n/gm, "")                         // * no início
    .replace(/\n\n\*$/gm, "")                         // * no fim
    // 11. Separa pergunta/CTA colada no último bullet
    .replace(/(•[^\n]+?)\s+(Qual|Você|Gostaria|Precisa|Quer|Posso|Aguardo|Me informe|Pode me|Alguma|Ficou|Para finalizar)/g, "$1\n\n$2")
    // 12. Remove espaços antes de quebra de linha
    .replace(/[ \t]+\n/g, "\n")
    // 13. Remove linhas em branco extras
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  console.log(`[sanitize v8] in=${text.length}chars out=${result.length}chars bullets=${(result.match(/\n•/g) ?? []).length}`);
  return result;
}

function buildSystemPrompt(clientName: string, customPrompt?: string, mediaLibrary?: AgentMedia[], knowledgeBase?: KnowledgeBaseDoc[]): string {
  const now = new Date();
  const today = now.toLocaleDateString("pt-BR", {
    weekday: "long", year: "numeric", month: "long", day: "numeric",
    timeZone: "America/Sao_Paulo",
  });
  const time = now.toLocaleTimeString("pt-BR", {
    hour: "2-digit", minute: "2-digit",
    timeZone: "America/Sao_Paulo",
  });
  const dateTimeInfo = `[Data e horário atual: ${today}, ${time} (horário de Brasília)]`;

  const base = `Você é um assistente de WhatsApp para ${clientName}.
Data e horário atual: ${today}, ${time} (horário de Brasília)

Você pode:
- Verificar horários disponíveis e agendar compromissos no Google Calendar
- Registrar follow-ups automáticos
- Enviar resumos da conversa para o gestor
- Ler e interpretar imagens enviadas pelo usuário (visão)
- Transcrever e compreender áudios enviados pelo usuário

Regras gerais:
- Sempre responda em português, mensagens curtas e amigáveis
- Ao receber áudio: transcreva internamente e responda com base no conteúdo do áudio
- Ao receber imagem: descreva brevemente o que vê e responda ao contexto da conversa
- Ao receber vídeo ou documento: reconheça o recebimento e pergunte como pode ajudar
- Ao agendar, confirme: data, hora e nome do lead
- Use listar_horarios_disponiveis antes de agendar para verificar disponibilidade
- Ao receber mensagem nova, cancele follow-ups pendentes deste contato

REGRAS OBRIGATÓRIAS DE FORMATAÇÃO PARA WHATSAPP:
- NUNCA use markdown: proibido **, __, ##, ---, >, \`\`\`
- Para negrito no WhatsApp use APENAS um asterisco: *texto* (nunca dois: **texto**)
- Cada item numerado (1., 2., 3.) DEVE começar em uma nova linha com uma linha em branco antes
- Separe sempre seções com uma linha em branco (deixe uma linha vazia entre blocos de conteúdo)
- Use • para listas de itens dentro de uma seção, cada um em sua própria linha
- NUNCA coloque o título de um item e seus sub-itens todos na mesma linha
- Exemplo correto de como listar produtos:

*1. PRODUTO A:*
• Cor: vermelha
• Preço: R$ 10,00

*2. PRODUTO B:*
• Cor: azul
• Preço: R$ 20,00

- Exemplo ERRADO (nunca faça assim): "**1. PRODUTO A:** • Cor: vermelha **2. PRODUTO B:**"
- Mantenha cada seção isolada e legível — pense que o cliente vai ler no celular`;

  // Instrução de mídias — só aparece se houver mídias com nome configuradas
  const namedMedia = (mediaLibrary ?? []).filter((m) => m.name?.trim());
  const mediaPart = namedMedia.length > 0
    ? `\n\nMídias disponíveis para enviar ao lead:\n${namedMedia.map((m) => {
        const tipo = m.type === "image" ? "imagem" : m.type === "video" ? "vídeo" : "documento";
        const desc = m.caption ? ` — "${m.caption}"` : "";
        return `• [${m.name}]: ${tipo}${desc}`;
      }).join("\n")}\n\nPara enviar uma mídia, inclua o marcador no texto da resposta:\n  [MIDIA:nome-da-midia]\nExemplo: "Aqui está nosso catálogo! [MIDIA:catalogo-produtos]"\nO arquivo será enviado automaticamente no lugar do marcador. Só envie mídia quando fizer sentido no contexto da conversa.\n\nPara enviar uma mensagem de texto APÓS as mídias (depois que as fotos chegarem), use:\n  [APOS_MIDIA:texto que será enviado depois das fotos]\nExemplo: "Aqui está o cardápio! [MIDIA:cardapio] [APOS_MIDIA:O que você achou? Quer fazer a reserva?]"\nO texto dentro de [APOS_MIDIA:...] é enviado automaticamente após todas as mídias serem entregues.`
    : "";

  // Base de conhecimento — documentos PDF/TXT carregados pelo gestor
  const kbDocs = (knowledgeBase ?? []).filter((d) => d.content?.trim());
  const kbPart = kbDocs.length > 0
    ? `\n\n--- BASE DE CONHECIMENTO ---\nOs documentos abaixo contêm informações importantes do negócio. Consulte-os ao responder perguntas sobre produtos, serviços, preços ou qualquer informação específica do cliente:\n\n${kbDocs.map((d) => `### ${d.name} (${d.filename})\n${d.content.trim()}`).join("\n\n---\n\n")}\n--- FIM DA BASE DE CONHECIMENTO ---`
    : "";

  if (customPrompt?.trim()) {
    return `${dateTimeInfo}\n\n${customPrompt.trim()}\n\n--- Capacidades do sistema ---\n${base}${mediaPart}${kbPart}`;
  }
  return `${base}${mediaPart}${kbPart}`;
}

export async function runGeminiAgent(
  userMessage: string,
  history: ChatMessage[],
  clientId: string,
  phone: string,
  connectionId?: string,
  mediaData?: { mimeType: string; data: string },
): Promise<{ text: string; actions: GeminiAction[] }> {
  const client = getClientById(clientId);
  if (!client) return { text: "", actions: [] };

  // Seleciona o agentConfig correto para esta conexão
  const agentCfg = getAgentConfigForConnection(client, connectionId);
  if (!agentCfg?.enabled) return { text: "", actions: [] };

  const apiKey = getGeminiApiKey(agentCfg.geminiApiKey);
  if (!apiKey) {
    console.error(`[gemini-agent] SEM API KEY — clientId=${clientId} phone=${phone} agentCfg.geminiApiKey=${agentCfg.geminiApiKey ? "definida" : "undefined"} GEMINI_API_KEY=${process.env.GEMINI_API_KEY ? "definida" : "undefined"}`);
    return { text: "", actions: [] };
  }
  console.log(`[gemini-agent] Iniciando — clientId=${clientId} phone=${phone} apiKey=${apiKey.slice(0, 8)}...`);

  const genAI = new GoogleGenerativeAI(apiKey);
  const mediaLibrary = agentCfg.mediaLibrary;
  const sysPrompt = buildSystemPrompt(client.name, agentCfg.systemPrompt, mediaLibrary, agentCfg.knowledgeBase);

  const modelsToTry = [
    "gemini-2.5-pro",
    "gemini-2.5-flash",
    "gemini-2.5-flash",
    "gemini-1.5-pro",
  ];

  // Converte histórico para formato Gemini
  // A mensagem atual já foi salva em conversations.json antes de chegar aqui —
  // se incluirmos ela no histórico E enviarmos via sendMessage, o Gemini recebe
  // dois turns consecutivos do usuário e rejeita. Por isso removemos o último
  // item se for do usuário (ele será enviado via sendMessage).
  const historyWithoutCurrent =
    history.length > 0 && history[history.length - 1].role === "user"
      ? history.slice(0, -1)
      : history;

  // Mescla mensagens consecutivas do mesmo papel (pode ocorrer com batching)
  const mergedHistory: { role: "user" | "model"; parts: { text: string }[] }[] = [];
  for (const m of historyWithoutCurrent.slice(-20)) {
    const role = m.role === "user" ? "user" : "model";
    if (mergedHistory.length > 0 && mergedHistory[mergedHistory.length - 1].role === role) {
      mergedHistory[mergedHistory.length - 1].parts[0].text += "\n" + m.content;
    } else {
      mergedHistory.push({ role, parts: [{ text: m.content }] });
    }
  }

  // Remove tail se terminar com user (startChat exige que termine com model ou vazio)
  if (mergedHistory.length > 0 && mergedHistory[mergedHistory.length - 1].role === "user") {
    mergedHistory.pop();
  }

  const rawHistory = mergedHistory.slice(-10);
  const firstUserIdx = rawHistory.findIndex((m) => m.role === "user");
  // Garante que o histórico começa com 'user' — Gemini rejeita se começar com 'model'
  // firstUserIdx === -1: nenhum user encontrado → histórico vazio
  // firstUserIdx === 0: já começa com user → usa tudo
  // firstUserIdx > 0: havia mensagens model antes do primeiro user → fatia a partir do user
  const geminiHistory = firstUserIdx >= 0 ? rawHistory.slice(firstUserIdx) : [];

  const actions: GeminiAction[] = [];
  let finalText = "";
  let succeeded = false;

  for (const usedModel of modelsToTry) {
    const model = genAI.getGenerativeModel({
      model: usedModel,
      systemInstruction: sysPrompt,
      tools: TOOLS,
    });

    console.log(`[gemini-agent] Tentando modelo: ${usedModel} clientId=${clientId} phone=${phone}`);

    const chat = model.startChat({ history: geminiHistory });

    try {
    // Monta as partes da mensagem (texto + mídia inline se disponível)
    const messageParts: Part[] = [{ text: userMessage }];
    if (mediaData?.data && mediaData?.mimeType) {
      messageParts.push({ inlineData: { mimeType: mediaData.mimeType, data: mediaData.data } });
    }
    let response = await chat.sendMessage(messageParts);
    let candidate = response.response;

    // Loop para processar tool calls
    while (true) {
      const parts = candidate.candidates?.[0]?.content?.parts ?? [];
      const toolCalls = parts.filter((p) => p.functionCall);

      if (toolCalls.length === 0) {
        finalText = (candidate.text() ?? "").trim();

        // Gemini 2.5 Pro às vezes retorna texto vazio após tool calls —
        // pede explicitamente uma resposta de texto ao usuário.
        if (!finalText) {
          try {
            console.log("[gemini-agent] Texto vazio após tools — solicitando resposta ao modelo");
            const retryResp = await chat.sendMessage(
              "Responda ao usuário em português com base nas ações que acabou de executar."
            );
            finalText = (retryResp.response.text() ?? "").trim();
          } catch (retryErr) {
            console.warn("[gemini-agent] Retry de texto falhou:", retryErr);
          }
        }

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
              if (agentCfg?.googleRefreshToken && agentCfg.googleCalendarId) {
                const slots = await listFreeSlots(
                  agentCfg.googleRefreshToken,
                  agentCfg.googleCalendarId,
                  args.data as string
                );
                result = { slots: slots.length > 0 ? slots : "Nenhum horário disponível" };
              } else {
                result = { error: "Google Calendar não conectado" };
              }
            }

            else if (call.name === "agendar_compromisso") {
              if (agentCfg?.googleRefreshToken && agentCfg.googleCalendarId) {
                const data = args.data as string;
                const horaInicio = args.hora_inicio as string;
                const duracao = (args.duracao_minutos as number) || 60;
                // Use -03:00 offset so Docker/UTC server preserves São Paulo time
                const startISO = `${data}T${horaInicio}:00-03:00`;
                const endMs = new Date(startISO).getTime() + duracao * 60000;
                const endSP = new Date(endMs).toLocaleString("sv", { timeZone: "America/Sao_Paulo" }).replace(" ", "T").substring(0, 19);
                const endISO = `${endSP}-03:00`;

                const { eventId, link } = await createEvent(
                  agentCfg.googleRefreshToken,
                  agentCfg.googleCalendarId,
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
              if (agentCfg?.googleRefreshToken && agentCfg.googleCalendarId) {
                const dataInicio = args.data_inicio as string;
                const dataFim = (args.data_fim as string | undefined);
                const timeMin = new Date(`${dataInicio}T00:00:00-03:00`).toISOString();
                const timeMax = dataFim
                  ? new Date(`${dataFim}T23:59:59-03:00`).toISOString()
                  : new Date(new Date(`${dataInicio}T00:00:00-03:00`).getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();
                const events = await listEvents(
                  agentCfg.googleRefreshToken,
                  agentCfg.googleCalendarId,
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
              if (agentCfg?.googleRefreshToken && agentCfg.googleCalendarId) {
                await cancelEvent(
                  agentCfg.googleRefreshToken,
                  agentCfg.googleCalendarId,
                  args.event_id as string
                );
                result = { ok: true };
                actions.push({ type: "agendamento_cancelado", eventId: args.event_id as string });
              } else {
                result = { error: "Google Calendar não conectado" };
              }
            }

            else if (call.name === "reagendar_agendamento") {
              if (agentCfg?.googleRefreshToken && agentCfg.googleCalendarId) {
                const data = args.data as string;
                const horaInicio = args.hora_inicio as string;
                const duracao = (args.duracao_minutos as number) || 60;
                // Use -03:00 offset so Docker/UTC server preserves São Paulo time
                const startISO = `${data}T${horaInicio}:00-03:00`;
                const endMs = new Date(startISO).getTime() + duracao * 60000;
                const endSP = new Date(endMs).toLocaleString("sv", { timeZone: "America/Sao_Paulo" }).replace(" ", "T").substring(0, 19);
                const endISO = `${endSP}-03:00`;
                await updateEvent(
                  agentCfg.googleRefreshToken,
                  agentCfg.googleCalendarId,
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
              if (agentCfg?.followUpEnabled) {
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

    succeeded = true;
    break; // modelo funcionou — sai do loop

    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      const isModelUnavailable =
        errMsg.includes("404") ||
        errMsg.toLowerCase().includes("not found") ||
        errMsg.toLowerCase().includes("not supported") ||
        errMsg.toLowerCase().includes("not available");

      if (isModelUnavailable) {
        console.warn(`[gemini-agent] Modelo ${usedModel} indisponível — tentando próximo...`);
        continue;
      }

      console.error(`[gemini-agent] ERRO na chamada ao Gemini: ${errMsg}`);
      console.error(`[gemini-agent] Detalhes: modelo=${usedModel} clientId=${clientId} phone=${phone} apiKey=${apiKey ? apiKey.slice(0,8) + "..." : "MISSING"}`);
      return { text: "Desculpe, tive um problema técnico. Pode repetir?", actions: [] };
    }
  } // fim do loop de modelos

  if (!succeeded) {
    console.error(`[gemini-agent] Todos os modelos falharam. clientId=${clientId} phone=${phone}`);
    return { text: "Desculpe, tive um problema técnico. Pode repetir?", actions: [] };
  }

  // Sanitiza markdown residual para WhatsApp
  console.log(`[sanitize-IN] ${JSON.stringify(finalText.slice(0, 300))}`);
  finalText = sanitizeForWhatsApp(finalText);
  console.log(`[sanitize-OUT] ${JSON.stringify(finalText.slice(0, 300))}`);
  const paras = finalText.split(/\n\s*\n/);
  console.log(`[sanitize-PARAS] total=${paras.length} sizes=${paras.map(p=>p.trim().length).join(",")}`);
  paras.forEach((p,i) => console.log(`[para ${i}] ${JSON.stringify(p.trim().slice(0,120))}`));

  console.log(`[gemini-agent] Resposta finalText.length=${finalText.length} actions=${actions.length}`);
  return { text: finalText, actions };
}

/**
 * Gera uma mensagem de follow-up inteligente usando IA, analisando o histórico da conversa.
 */
export async function generateFollowUpAI(
  history: ChatMessage[],
  leadName: string | undefined,
  clientName: string,
  geminiApiKey: string | null,
): Promise<string | null> {
  if (!geminiApiKey) return null;
  try {
    const ai = new GoogleGenerativeAI(geminiApiKey);
    const model = ai.getGenerativeModel({ model: "gemini-1.5-flash" });

    const firstName = leadName ? leadName.split(" ")[0] : null;
    const historyText = history
      .slice(-20)
      .map((m) => `${m.role === "user" ? "Lead" : "Agente"}: ${m.content}`)
      .join("\n");

    const prompt = `Você é um assistente de vendas para ${clientName}.
${firstName ? `O lead se chama ${firstName}.` : ""}
Analise o histórico de conversa abaixo e crie uma mensagem de follow-up inteligente e personalizada em português.
Seja natural, breve (2-3 frases), retome o contexto de onde a conversa parou e demonstre interesse genuíno.
${firstName ? `Use o primeiro nome "${firstName}" para personalizar a mensagem.` : ""}
Retorne APENAS a mensagem, sem explicações adicionais.

Histórico:
${historyText || "Sem histórico de conversa disponível. Crie uma mensagem de reengajamento gentil."}`;

    const result = await model.generateContent(prompt);
    return result.response.text().trim() || null;
  } catch (e) {
    console.error("[gemini-agent] generateFollowUpAI error:", e);
    return null;
  }
}
