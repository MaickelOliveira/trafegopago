import { GoogleGenerativeAI, SchemaType, type Tool, type FunctionDeclaration, type Part } from "@google/generative-ai";
import { getClientById, getAgentConfigForConnection, type AgentMedia, type KnowledgeBaseDoc, type SheetTabMapping } from "./clients";
import { getGeminiApiKey } from "./whatsapp-send";
import { scheduleFollowUp } from "./followups";
import { createEvent, listFreeSlots, cancelEvent, listEvents, updateEvent } from "./google-calendar";
import { getSheetHeadersCached, appendRow } from "./google-sheets";
import { getHistory } from "./conversations";
import type { ChatMessage } from "./conversations";

export type GeminiAction =
  | { type: "agendamento_criado"; eventId: string; link: string; titulo: string; dataHora: string }
  | { type: "followup_agendado"; horas: number; mensagem: string }
  | { type: "lembrete_agendado"; dataHora: string; mensagem: string }
  | { type: "resumo_solicitado"; motivo: string; phone: string }
  | { type: "agendamento_cancelado"; eventId: string }
  | { type: "planilha_linha_adicionada"; linha: Record<string, string> };

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
    description: "Envia um aviso da conversa para o gestor. OBRIGATÓRIO usar: (1) quando cliente fornecer dados completos de reserva — motivo deve começar com 'DADOS RECEBIDOS:'; (2) quando cliente enviar comprovante ou confirmar Pix — motivo deve começar com 'PAGAMENTO PIX:'; (3) dúvidas sem resposta no conhecimento.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        motivo: { type: SchemaType.STRING, description: "Resumo do motivo. Para reservas use prefixo 'DADOS RECEBIDOS:'. Para pagamentos use prefixo 'PAGAMENTO PIX:'." },
      },
      required: ["motivo"],
    },
  },
];

function slugifyHeader(header: string, used: Set<string>): string {
  let base = header
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (!base) base = "coluna";
  let key = base;
  let i = 2;
  while (used.has(key)) { key = `${base}_${i}`; i++; }
  used.add(key);
  return key;
}

function isPhoneHeader(header: string): boolean {
  return /telefone|celular|whatsapp|fone|contato/i.test(header);
}

function isDateHeader(header: string): boolean {
  return /data|dia|check.?in|entrada/i.test(header);
}

type SheetTool = {
  declaration: FunctionDeclaration;
  // Para aba única (legado): keyToHeader e headers preenchidos; tabMap vazio
  // Para múltiplas abas: tabMap por label, keyToHeader é a união de todas as abas
  keyToHeader: Record<string, string>;
  headers: string[];
  tabMap: Map<string, { headers: string[]; keyToHeader: Record<string, string> }>;
};

// Monta a tool para aba única (modo legado)
function buildSheetTool(headers: string[]): SheetTool {
  const used = new Set<string>();
  const properties: Record<string, { type: SchemaType.STRING; description: string }> = {};
  const keyToHeader: Record<string, string> = {};

  for (const header of headers) {
    const key = slugifyHeader(header, used);
    keyToHeader[key] = header;
    let description = `Valor para a coluna "${header}" da planilha.`;
    if (isPhoneHeader(header)) description += " Se não for informado, é preenchido automaticamente com o telefone de contato do cliente.";
    else if (isDateHeader(header)) description += " Use o formato DD/MM/AAAA. Se não for informado, é preenchido automaticamente com a data de hoje.";
    properties[key] = { type: SchemaType.STRING, description };
  }

  return {
    declaration: {
      name: "adicionar_linha_planilha",
      description: `Adiciona uma nova linha na planilha de controle deste negócio (colunas: ${headers.join(", ")}). Chame esta função sempre que o cliente informar dados de uma reserva/hospedagem, como nome de pessoas, telefone, datas ou pagamento. Se o cliente informar os nomes de várias pessoas para a mesma reserva, chame esta função uma vez para CADA pessoa. Preencha todas as colunas que conseguir identificar a partir da conversa.`,
      parameters: { type: SchemaType.OBJECT, properties, required: [] },
    },
    keyToHeader,
    headers,
    tabMap: new Map(),
  };
}

// Monta a tool para múltiplas abas — cada aba vira uma opção de "tipo_reserva"
function buildSheetToolMulti(
  tabResults: Array<{ mapping: SheetTabMapping; headers: string[] }>
): SheetTool {
  const tabMap = new Map<string, { headers: string[]; keyToHeader: Record<string, string> }>();

  // Constrói o mapa por label e coleta todos os headers únicos
  const allHeadersSet = new Set<string>();
  for (const { mapping, headers } of tabResults) {
    const used = new Set<string>();
    const k2h: Record<string, string> = {};
    for (const h of headers) {
      const key = slugifyHeader(h, used);
      k2h[key] = h;
      allHeadersSet.add(h);
    }
    tabMap.set(mapping.label, { headers, keyToHeader: k2h });
  }

  // União de todas as colunas para o schema da tool
  const allHeaders = [...allHeadersSet];
  const used = new Set<string>();
  const properties: Record<string, { type: SchemaType.STRING; description: string }> = {};
  const keyToHeader: Record<string, string> = {};

  for (const header of allHeaders) {
    const key = slugifyHeader(header, used);
    keyToHeader[key] = header;
    let description = `Valor para a coluna "${header}".`;
    if (isPhoneHeader(header)) description += " Se não for informado, preenche automaticamente com o telefone do cliente.";
    else if (isDateHeader(header)) description += " Formato DD/MM/AAAA. Se não for informado, preenche com a data de hoje.";
    properties[key] = { type: SchemaType.STRING, description };
  }

  const labels = tabResults.map((t) => t.mapping.label);
  // Adiciona tipo_reserva como primeiro campo
  properties["tipo_reserva"] = {
    type: SchemaType.STRING,
    description: `Tipo de reserva que determina em qual aba da planilha a linha será registrada. Valores possíveis: ${labels.map((l) => `"${l}"`).join(", ")}. Escolha com base no contexto da conversa.`,
  };

  return {
    declaration: {
      name: "adicionar_linha_planilha",
      description: `Registra uma nova linha na aba correta da planilha de controle, conforme o tipo de reserva (${labels.join(", ")}). Chame sempre que o cliente informar dados de reserva (nomes, telefone, datas, pagamento). Para várias pessoas na mesma reserva, chame uma vez por pessoa. Preencha todas as colunas identificáveis.`,
      parameters: { type: SchemaType.OBJECT, properties, required: ["tipo_reserva"] },
    },
    keyToHeader,
    headers: allHeaders,
    tabMap,
  };
}

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
    //    Cobre espaço normal, NBSP (u00a0) e qualquer whitespace antes de •
    .replace(/[ \t ]+•/g, "\n•")
    // 8. Bullets nunca devem ter linha em branco entre eles, MAS sub-títulos bold (Malha, Fio...)
    //    devem ter linha em branco antes para separar grupos dentro de uma seção
    .replace(/\n(•\s*\*[^*\n]+\*[:\s*])/g, "\n\n$1")  // linha em branco antes de bullet bold (sub-título)
    .replace(/\n\n\n(•)/g, "\n\n$1")                   // no máximo 2 newlines antes de bullet normal
    // 9. Garante \n\n antes de itens numerados: *1. *2. ou 1. 2. no meio do texto
    .replace(/([^\n]) (\d+\. [A-ZÁÉÍÓÚÂÊÎÔÛÃÕÇ])/g, "$1\n\n$2")  // "texto N. TÍTULO" → \n\n
    .replace(/\n(\*?\d+[\.\)]\s)/g, "\n\n$1")           // 1 newline → 2
    // Protege centavos (",NN" — sempre 2 dígitos em R$) de serem engolidos pelo
    // número do próximo item colado direto na frente (ex: "R$ 19,152. Item" lia
    // "152" como o número do item, cortando o preço em "19," + "152.")
    .replace(/(,\d{2})(\d+[\.\)]\s)/g, "$1\n\n$2")
    // 0 newlines → 2 — exclui "*" do grupo 1: sem isso, o próprio "*" de abertura
    // de "*N. Título*" era tratado como "texto antes do número" e ficava isolado
    // (depois apagado pela regra 10), sobrando só o "*" de fechamento
    .replace(/([^\n*])(\*?\d+[\.\)]\s)/g, "$1\n\n$2")
    // 10. Remove asteriscos solitários em parágrafos próprios (resíduo de ** multi-linha)
    //     ex: "\n\n*\n\n" → "\n\n" e "* solt\n\nN." → "N."
    .replace(/\n\n\*\n\n(\d+[\.\)]\s)/g, "\n\n$1")  // *\n\nN. → N.
    .replace(/\n\n\*\n\n/g, "\n\n")                  // *\n\n solto no meio
    .replace(/^\*\n\n/gm, "")                         // * no início
    .replace(/\n\n\*$/gm, "")                         // * no fim
    // 11. Separa pergunta/CTA colada no último bullet
    .replace(/(•[^\n]+?)\s+(Qual|Você|Gostaria|Precisa|Quer|Posso|Aguardo|Me informe|Pode me|Alguma|Ficou|Para finalizar|Gostaria de|Qual desses|Qual dessas|Qual destes|Qual deste|Há algo|Tem alguma)/g, "$1\n\n$2")
    // 12. Remove espaços antes de quebra de linha
    .replace(/[ \t]+\n/g, "\n")
    // 13. Remove linhas em branco extras
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  console.log(`[sanitize v8] in=${text.length}chars out=${result.length}chars bullets=${(result.match(/\n•/g) ?? []).length}`);
  return result;
}

function buildSystemPrompt(clientName: string, customPrompt?: string, mediaLibrary?: AgentMedia[], knowledgeBase?: KnowledgeBaseDoc[], sheetHeaders?: string[], sheetTypes?: string[], hasSheet?: boolean, hasAvisos?: boolean): string {
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
- Transcrever e compreender áudios enviados pelo usuário${sheetHeaders?.length ? "\n- Registrar dados de reservas, compra de ingressos ou cadastros em uma planilha do Google Sheets" : ""}

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

  // Planilha do Google Sheets — informa as colunas para a IA saber o que coletar
  const sheetPart = sheetHeaders?.length
    ? sheetTypes?.length
      ? `\n\nPlanilha de controle conectada. Tipos de reserva configurados: ${sheetTypes.map((t) => `"${t}"`).join(", ")}.\nSempre que o cliente confirmar uma reserva, comprar ingressos ou fornecer dados de cadastro (nome, telefone, data, pagamento etc.), use IMEDIATAMENTE a função adicionar_linha_planilha com o tipo_reserva correto. Para cada pessoa/participante, chame a função uma vez. Preencha todas as colunas que conseguir identificar na conversa.`
      : `\n\nPlanilha de reservas conectada — colunas: ${sheetHeaders.join(", ")}.\nSempre que o cliente fornecer dados de reserva (nome, telefone, data, pagamento), use IMEDIATAMENTE a função adicionar_linha_planilha para cada pessoa. Preencha apenas as colunas informadas.`
    : "";

  const resumoRule = `
REGRA CRÍTICA — enviar_resumo:
Quando chamar enviar_resumo, o conteúdo do resumo/motivo vai SOMENTE para o gestor via ferramenta — JAMAIS inclua no texto visível ao cliente:
• NUNCA escreva "DADOS RECEBIDOS", "PAGAMENTO PIX", "O lead é...", "O cliente é..." ou qualquer análise interna no texto enviado ao cliente.
• NUNCA narre para o cliente que você encaminhou/escalou: não diga "já encaminhei para...", "vou passar para...", "escalei para...".
• Após chamar a ferramenta, responda ao cliente de forma natural e breve, sem repetir o conteúdo interno.`;

  const resumoPart = hasSheet
    ? `\n\nRegistro automático de reservas (planilha conectada):
Você tem a ferramenta enviar_resumo disponível. Acione-a como chamada de ferramenta nos seguintes momentos:
- Dados de reserva recebidos: use motivo iniciando com as palavras exatas DADOS RECEBIDOS seguido de um resumo curto
- Comprovante ou confirmação de Pix recebidos: use motivo iniciando com as palavras exatas PAGAMENTO PIX seguido do valor
- Quando não souber responder, precisar escalar para o gestor, ou o lead pedir atendimento humano: use motivo descrevendo o assunto
Importante: acione a ferramenta, não escreva o nome dela como texto na resposta. A mensagem visível ao cliente é só a parte natural da conversa — nunca inclua o nome da ferramenta, a palavra "motivo", nem qualquer narração tipo "(chamada da ferramenta...)" explicando o que você está fazendo internamente.
${resumoRule}`
    : hasAvisos
    ? `\n\nVocê tem a ferramenta enviar_resumo disponível. Use-a como chamada de ferramenta (não como texto) nos seguintes casos:
- Quando não souber responder algo ou precisar escalar para o gestor: motivo descrevendo o assunto
- Quando o lead pedir falar com humano ou com o responsável: motivo iniciando com ATENDIMENTO HUMANO
- Quando o lead demonstrar intenção de compra e precisar de atendimento personalizado: motivo com resumo do interesse
Importante: acione a ferramenta imediatamente, sem escrever o nome dela na resposta. A mensagem visível ao cliente é só a parte natural da conversa — nunca inclua o nome da ferramenta, a palavra "motivo", nem qualquer narração tipo "(chamada da ferramenta...)" explicando o que você está fazendo internamente.
${resumoRule}`
    : "";

  if (customPrompt?.trim()) {
    return `${dateTimeInfo}\n\n${customPrompt.trim()}\n\n--- Capacidades do sistema ---\n${base}${mediaPart}${kbPart}${sheetPart}${resumoPart}`;
  }
  return `${base}${mediaPart}${kbPart}${sheetPart}${resumoPart}`;
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

  // Planilha do Google Sheets — preenchimento sempre feito pelo extrator externo
  // (sheet-extractor.ts com Gemini 2.0 Flash) após cada resposta do agente principal.
  // A sheet tool é omitida aqui para economizar tokens do agente principal.
  const sheetTool = null;

  const hasSheet = !!(agentCfg.googleRefreshToken && agentCfg.spreadsheetId && agentCfg.sheetMappings?.length);
  const hasAvisos = !!(agentCfg.avisos?.length || agentCfg.summaryPhone || agentCfg.metaSummaryTemplateName);
  const sysPrompt = buildSystemPrompt(client.name, agentCfg.systemPrompt, mediaLibrary, agentCfg.knowledgeBase, undefined, undefined, hasSheet, hasAvisos);
  const tools: Tool[] = [{ functionDeclarations: [...TOOL_DECLARATIONS] }];

  const modelsToTry = [
    "gemini-3.1-flash-lite",
    "gemini-2.5-flash",
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
  for (const m of historyWithoutCurrent.slice(-40)) {
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

  const rawHistory = mergedHistory.slice(-24);
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
      tools,
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

        // Modelo chamou tools mas não gerou texto — não envia mensagem ao usuário.
        // As actions (enviar_resumo, planilha etc.) continuam sendo processadas normalmente.
        if (!finalText) {
          console.log("[gemini-agent] Texto vazio após tools — nenhuma mensagem enviada ao usuário");
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

            else if (call.name === "adicionar_linha_planilha") {
              // Planilha gerenciada pelo sheet-extractor externo — não usado aqui
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
      const errLower = errMsg.toLowerCase();

      // Erros que justificam tentar o próximo modelo
      const isModelUnavailable =
        errLower.includes("404") ||
        errLower.includes("429") ||
        errLower.includes("too many") ||
        errLower.includes("not found") ||
        errLower.includes("not supported") ||
        errLower.includes("not available") ||
        errLower.includes("overloaded") ||
        errLower.includes("503") ||
        errLower.includes("resource_exhausted") ||
        errLower.includes("quota") ||
        errLower.includes("rate limit") ||
        errLower.includes("depleted") ||
        errLower.includes("credits");

      console.warn(`[gemini-agent] Erro modelo=${usedModel} disponivel=${!isModelUnavailable} ERRO: ${errMsg.slice(0, 200)}`);

      if (isModelUnavailable) {
        continue;
      }

      // Erro não-recuperável (ex: INVALID_ARGUMENT, API_KEY_INVALID, history inválido)
      console.error(`[gemini-agent] Erro não-recuperável — abortando. modelo=${usedModel} clientId=${clientId}`);
      return { text: "Desculpe, tive um problema técnico. Pode repetir?", actions: [] };
    }
  } // fim do loop de modelos

  if (!succeeded) {
    console.error(`[gemini-agent] Todos os modelos falharam. clientId=${clientId} phone=${phone}`);
    return { text: "Desculpe, tive um problema técnico. Pode repetir?", actions: [] };
  }

  // Extrai chamadas de enviar_resumo que o modelo escreveu como TEXTO em vez de
  // via function call nativa (ex: bloco "tool_code" / "print(enviar_resumo(motivo='...'))").
  // Sem isso, o motivo nunca chega a processMetaActions/sheet-extractor — o aviso
  // e o registro na planilha simplesmente não disparam, mesmo aparecendo na resposta.
  const RESUMO_TEXT_CALL = /enviar_resumo\s*\(\s*motivo\s*=\s*['"]([^'"]*)['"]\s*\)/gi;
  let resumoMatch: RegExpExecArray | null;
  while ((resumoMatch = RESUMO_TEXT_CALL.exec(finalText)) !== null) {
    const motivo = resumoMatch[1];
    if (!actions.some((a) => a.type === "resumo_solicitado" && a.motivo === motivo)) {
      console.warn(`[gemini-agent] enviar_resumo vazou como texto — extraindo motivo="${motivo}"`);
      actions.push({ type: "resumo_solicitado", motivo, phone });
    }
  }

  // Extrai o mesmo vazamento, mas em forma NARRADA em português (ex: "*Motivo:
  // ATENDIMENTO HUMANO - ...*" seguido de "(Chamada da ferramenta enviar_resumo)")
  // em vez da sintaxe de função. Sem isso o aviso ao gestor não dispara mesmo
  // aparecendo (errado) na resposta visível ao cliente.
  // Cobre tanto "*Motivo: ...*" quanto "• Motivo: ..." (formato bullet que o modelo
  // às vezes gera quando estrutura o aviso como lista numerada/bulleted).
  const NARRATED_MOTIVO = /^[•\-–]?\s*\*?Motivo:\s*([^\n*]+?)\*?\s*$/im;
  const narratedMatch = finalText.match(NARRATED_MOTIVO);
  if (narratedMatch) {
    const motivo = narratedMatch[1].trim();
    if (motivo && !actions.some((a) => a.type === "resumo_solicitado" && a.motivo === motivo)) {
      console.warn(`[gemini-agent] enviar_resumo vazou como narração — extraindo motivo="${motivo}"`);
      actions.push({ type: "resumo_solicitado", motivo, phone });
    }
  }

  // Remove qualquer vazamento de chamada de ferramenta escrita como texto/código
  // (linha "tool_code", "print(enviar_resumo(...))", ou a chamada nua) do corpo visível,
  // e também a variante narrada em português ("*Motivo: ...*" / "(Chamada da ferramenta ...)").
  const KNOWN_TOOL_CALL = /(enviar_resumo|adicionar_linha_planilha|agendar_compromisso|cancelar_agendamento|reagendar_agendamento|listar_agendamentos|listar_horarios_disponiveis|agendar_followup)\s*\(/;
  const NARRATED_MOTIVO_LINE = /^\*?Motivo:\s*.+$/i;
  // Bullet/numbered "Motivo:" — ex: "• Motivo: ..." ou "- Motivo: ..."
  const BULLET_MOTIVO_LINE = /^[•\-–]\s*\*?Motivo:\s*.+$/i;
  const TOOL_CALL_NARRATION = /chamada\s+da\s+ferramenta|function\s*call|tool\s*call/i;
  // Cabeçalhos de seção interna do modelo — ex: "1. RESUMO PARA O GESTOR:" ou "RESUMO:"
  const INTERNAL_SECTION = /resumo\s+para\s+o\s+gestor|para\s+o\s+gestor|resumo\s+da\s+conversa\s*:/i;
  // Conteúdo interno que NUNCA deve ir para o cliente
  const INTERNAL_CONTENT = /^(DADOS RECEBIDOS|PAGAMENTO PIX|ATENDIMENTO HUMANO)\s*[:\-]/i;
  // Análise de perfil do lead/cliente escrita para o gestor
  const LEAD_PROFILE_LINE = /^O\s+(lead|cliente)\s+é\s+/i;
  finalText = finalText
    .split("\n")
    .filter((line) => {
      const t = line.trim();
      if (!t) return true;
      if (t === "tool_code" || t === "```tool_code" || t === "```") return false;
      if (KNOWN_TOOL_CALL.test(t)) return false;
      if (NARRATED_MOTIVO_LINE.test(t)) return false;
      if (BULLET_MOTIVO_LINE.test(t)) return false;
      if (INTERNAL_SECTION.test(t)) return false;
      if (TOOL_CALL_NARRATION.test(t)) return false;
      if (INTERNAL_CONTENT.test(t)) return false;
      if (LEAD_PROFILE_LINE.test(t)) return false;
      return true;
    })
    .join("\n")
    .trim();

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
  systemPrompt?: string,
): Promise<string | null> {
  if (!geminiApiKey) return null;

  const firstName = leadName ? leadName.split(" ")[0] : null;
  const hasUserMessage = history.some((m) => m.role === "user");

  // Inclui o system prompt (contexto do negócio) para evitar alucinações
  const businessContext = systemPrompt?.trim()
    ? `\n\nContexto do negócio:\n${systemPrompt.slice(0, 1500)}`
    : "";

  let prompt: string;

  if (!hasUserMessage) {
    // Lead nunca respondeu — gera reengajamento genérico baseado só no negócio
    prompt = `Você é um assistente de vendas para ${clientName}.${businessContext}
${firstName ? `O lead se chama ${firstName}.` : ""}
O lead recebeu nossa saudação inicial mas ainda não respondeu. Crie uma mensagem de follow-up curta (1-2 frases) em português para reengajá-lo.
Regras OBRIGATÓRIAS:
- Mencione apenas serviços ou benefícios que estejam explícitos no contexto do negócio acima
- Não invente nenhum detalhe, produto, serviço ou assunto que não esteja no contexto
- Seja gentil, breve e direto
- Se o contexto não tiver informações suficientes, escreva apenas: "Olá${firstName ? `, ${firstName}` : ""}! Ainda posso te ajudar? Estou à disposição. 😊"
${firstName ? `- Use o primeiro nome "${firstName}"` : ""}
Retorne APENAS a mensagem, sem explicações.`;
  } else {
    // Lead respondeu — retoma o contexto real da conversa
    const historyText = history
      .slice(-20)
      .map((m) => `${m.role === "user" ? "Lead" : "Agente"}: ${m.content}`)
      .join("\n");

    prompt = `Você é um assistente de vendas para ${clientName}.${businessContext}
${firstName ? `O lead se chama ${firstName}.` : ""}
Analise o histórico abaixo e crie uma mensagem de follow-up personalizada em português (2-3 frases).
Regras OBRIGATÓRIAS:
- Retome o contexto exato de onde a conversa parou
- Mencione apenas serviços ou assuntos presentes no histórico ou no contexto do negócio
- Nunca invente informações, produtos ou serviços
${firstName ? `- Use o primeiro nome "${firstName}"` : ""}
Retorne APENAS a mensagem, sem explicações.

Histórico:
${historyText}`;
  }

  const modelsToTry = ["gemini-3.1-flash-lite", "gemini-2.5-flash"];
  for (const modelId of modelsToTry) {
    try {
      const ai = new GoogleGenerativeAI(geminiApiKey);
      const model = ai.getGenerativeModel({ model: modelId });
      const result = await model.generateContent(prompt);
      const text = result.response.text().trim();
      if (text) {
        console.log(`[gemini-agent] generateFollowUpAI OK model=${modelId}`);
        return text;
      }
    } catch (e) {
      console.error(`[gemini-agent] generateFollowUpAI model=${modelId} error:`, e instanceof Error ? e.message : e);
    }
  }
  return null;
}
