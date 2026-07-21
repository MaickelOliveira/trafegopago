import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import path from "path";
import type { AutomationsConfig } from "./automations";
import type { PousadaTipo } from "./pousada-types";

export type AdAccount = {
  id: string;
  name: string;
  platform: "meta" | "google";
};

export type FunnelType = "leads" | "sales" | "traffic";

export type FollowUpStep = {
  id: string;
  delayHours: number; // horas após o step anterior (ou após o primeiro contato para o step 1)
  message: string;
  label?: string;     // nome opcional para identificar o step
  messageType?: "text" | "ai" | "template"; // tipo de mensagem
  templateId?: string;                       // id do template Meta (quando messageType === "template")
  templateCategory?: "MARKETING" | "UTILITY"; // categoria para filtrar templates
  templateVariables?: Record<string, string>; // variáveis do template
};

export type AgentMedia = {
  id: string;
  name: string;                // nome curto para referenciar (ex: "tabela-precos")
  type: "image" | "video" | "document";
  url: string;
  caption?: string;
  filename?: string;           // nome exibido para documentos
  sendOnFirstContact: boolean; // dispara quando o lead entra em contato pela primeira vez
};

export type KnowledgeBaseDoc = {
  id: string;
  name: string;       // nome exibido (ex: "Tabela de Produtos")
  filename: string;   // nome original do arquivo
  content: string;    // texto extraído do PDF/TXT
  uploadedAt: number;
};

export type AvisoRecipient = {
  id: string;        // uuid gerado no cliente
  label: string;     // ex: "Gestor", "Grupo Vendas"
  value: string;     // ex: "5511999990000" ou "120363xxxx@g.us"
  type: "phone" | "group";
};

export type AgentConfig = {
  enabled: boolean;              // Liga/desliga o agente
  followUpEnabled: boolean;      // Liga/desliga follow-ups separadamente
  name?: string;                 // Nome/rótulo do agente (ex: "Agente Vendas", "Suporte")
  geminiApiKey?: string;         // Chave Gemini (sobrescreve a global se preenchida)
  googleCalendarId?: string;     // Calendar ID do cliente (ex: "primary")
  googleRefreshToken?: string;   // OAuth refresh token do Google Calendar
  summaryPhone?: string;         // Legado — use avisos[] para novos destinatários
  avisos?: AvisoRecipient[];     // Destinatários de avisos (números e grupos WhatsApp)
  metaSummaryTemplateName?: string; // Template Meta aprovado para avisos via API oficial (ex: "aviso2")
  followUps: FollowUpStep[];     // Sequência de follow-ups configurados
  followUpContext?: string;      // Contexto curto do negócio para a IA decidir se envia follow-up (ex: "pousada, clientes pessoa física, filtrar fornecedores")
  systemPrompt?: string;         // Instruções do agente para este cliente
  whatsappConnectionId?: string; // ID da conexão WhatsApp que o agente usa
  messageWaitSeconds?: number;   // Segundos de espera para acumular mensagens (0 = desabilitado)
  mediaLibrary?: AgentMedia[];   // Fotos, vídeos e documentos que o agente pode disparar
  splitMessages?: boolean;       // Divide respostas longas em múltiplas mensagens
  maxMessageLength?: number;     // Máx. de caracteres por mensagem (padrão: 300)
  splitMessageDelaySeconds?: number; // Intervalo entre cada mensagem dividida (padrão: 1.5s)
  aiResumeKeyword?: string;      // Palavra-chave enviada pelo gestor para reativar a IA (ex: "atendimento finalizado")
  testPhone?: string;            // Número de teste: quando preenchido, a IA responde APENAS este número
  knowledgeBase?: KnowledgeBaseDoc[]; // Documentos PDF/TXT que a IA pode consultar
  spreadsheetId?: string;        // ID da planilha do Google Sheets vinculada ao agente
  spreadsheetName?: string;      // Nome da planilha (exibição)
  sheetTabName?: string;         // Legado — aba única; use sheetMappings para múltiplas abas
  sheetMappings?: SheetTabMapping[]; // Mapeamento tipo-de-reserva → aba da planilha
  appsScriptUrl?: string;        // URL do Google Apps Script para preenchimento da planilha (gratuito, sem OAuth)
};

export type SheetTabMapping = {
  tipo: string;    // ex: "hospedagem", "day_use" (slug interno)
  label: string;   // ex: "Hospedagem", "Day Use" (exibição e valor para a IA)
  tabName: string; // nome exato da aba no Google Sheets
};

export type Client = {
  id: string;
  name: string;
  email: string;
  passwordHash: string;
  logoUrl?: string;
  color: string;
  cplTarget: number;
  funnelType: FunnelType;
  adAccounts: AdAccount[];
  whatsappPhone?: string;
  automations?: AutomationsConfig;
  pixelId?: string;             // ID do pixel Meta (fbq browser + CAPI)
  capiToken?: string;           // Token de Conversão da API (gerado no Gerenciador de Eventos → Dataset)
  capiTestEventCode?: string;   // Código temporário da aba "Testar eventos" do Gerenciador de Eventos — só preencher durante testes, remover depois
  googleAdsId?: string;         // ID de conta Google Ads  (ex: AW-123456789)
  googleConvLabel?: string;     // Label de conversão Google Ads (ex: AbCdEfGhI)
  kanbanAgentEnabled?: boolean; // Agente IA de CRM ativo (default: true se anthropicApiKey configurado)
  kanbanAgentPrompt?: string;   // Prompt configurável que guia quando mover/pular um lead no Kanban
  enabledSystems?: string[];    // Slugs de AVAILABLE_SYSTEMS (src/lib/systems.ts) habilitados pra este cliente
  pousadaTipos?: PousadaTipo[]; // Tipos de reserva configuráveis do sistema de Pousada (ex: Hospedagem, Day Use, Dia das Mães)
  pousadaTotalQuartos?: number; // Total de quartos/chalés pro mapa de ocupação do sistema de Pousada
  metaPageId?: string;          // ID da página do Facebook (para Lead Ads — vincula leads ao cliente certo)
  agentConfig?: AgentConfig;    // Configuração do agente principal (retrocompat)
  agentConfigs?: AgentConfig[]; // Lista de agentes — um por conexão WhatsApp
};

export type AppConfig = {
  manager: { email: string; passwordHash: string };
  metaToken: string;
  metaAppId?: string;
  metaAppSecret?: string;
  uazapiServer?: string;
  uazapiToken?: string;          // token de instância (envio)
  uazapiAdminToken?: string;     // token de admin (criar/gerenciar instâncias)
  uazapiWebhookForward?: string;
  appBaseUrl?: string;
  anthropicApiKey?: string;
  geminiApiKey?: string;         // Chave global do Gemini (usada quando cliente não tem a própria)
  googleClientId?: string;       // Google OAuth client ID (Calendar + Ads, mesmo client)
  googleClientSecret?: string;   // Google OAuth client secret
  googleAdsDeveloperToken?: string;  // Developer Token do Centro de API do Google Ads
  googleAdsRefreshToken?: string;    // OAuth refresh token (escopo adwords) — conexão única p/ toda a agência, nunca exposto ao browser
  googleAdsLoginCustomerId?: string; // ID da conta MCC/gerenciadora (sem hífen), opcional
  agentCronSecret?: string;      // Secret para proteger o endpoint de cron
  masterPhone?: string;              // Número master: recebe notificações do sistema (com DDI, só dígitos)
  masterConnectionId?: string;       // ID da FunnelConnection usada para enviar mensagens do sistema
  // Campos usados SOMENTE quando a conexão master é Meta (API Oficial)
  // Para UazAPI, a IA compõe a mensagem livremente
  masterMetaTemplateBriefing?: string;  // Nome do template aprovado para notificação de briefing
  masterMetaLanguage?: string;          // Código de idioma do template (ex: pt_BR)
  // WPPConnect Server
  wppconnectServer?: string;            // URL base do servidor WPPConnect (ex: https://wpp.meuservidor.com)
  wppconnectSecretKey?: string;         // Secret key do servidor WPPConnect
  // Evolution API Server
  evolutionServer?: string;             // URL base do servidor Evolution API (ex: https://evo.meuservidor.com)
  evolutionAdminKey?: string;           // apikey global (admin) — cria/gerencia instâncias
};

const DATA_DIR = path.join(process.cwd(), "data");

function ensureDataDir() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
}

function readJsonFile<T>(file: string, fallback: T): T {
  try {
    const raw = readFileSync(path.join(DATA_DIR, file), "utf-8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function getClients(): Client[] {
  return readJsonFile<{ clients: Client[] }>("clients.json", { clients: [] }).clients;
}

export function getClientById(id: string): Client | undefined {
  return getClients().find((c) => c.id === id);
}

/** Retorna o AgentConfig correto para uma conexão específica.
 *  Procura em agentConfigs primeiro, depois cai no agentConfig padrão. */
export function getAgentConfigForConnection(
  client: Client,
  connectionId?: string | null
): AgentConfig | undefined {
  if (connectionId) {
    const specific = client.agentConfigs?.find(
      (c) => c.whatsappConnectionId === connectionId
    );
    if (specific) return specific;
    // Cliente já usa config por conexão (agentConfigs[] não vazio) — uma conexão
    // NOVA sem config própria não deve herdar o agentConfig legado de OUTRA
    // conexão do mesmo cliente. Sem essa checagem, um número recém-adicionado
    // "puxava" a config antiga/genérica do cliente (podendo vir com enabled:true
    // mesmo nunca tendo sido configurada pra esse número específico).
    if (client.agentConfigs && client.agentConfigs.length > 0) {
      return undefined;
    }
  }
  return client.agentConfig;
}

/** Salva o AgentConfig para uma conexão específica (espelha getAgentConfigForConnection).
 *  Com connectionId, faz upsert em agentConfigs[]; sem connectionId, salva no agentConfig padrão. */
export function upsertAgentConfigForConnection(
  client: Client,
  connectionId: string | null | undefined,
  updated: AgentConfig
): void {
  if (connectionId) {
    const existing = client.agentConfigs ?? [];
    const idx = existing.findIndex((c) => c.whatsappConnectionId === connectionId);
    const newConfigs = [...existing];
    if (idx >= 0) newConfigs[idx] = updated;
    else newConfigs.push({ ...updated, whatsappConnectionId: connectionId });
    upsertClient({ ...client, agentConfigs: newConfigs });
  } else {
    upsertClient({ ...client, agentConfig: updated });
  }
}

/**
 * Repointa o whatsappConnectionId de um AgentConfig (órfão ou em uso em outra
 * conexão) para uma conexão nova — preserva todo o resto da config (prompt,
 * follow-ups, base de conhecimento etc.), sem perda de dados. O agente é uma
 * entidade própria identificada pelo seu whatsappConnectionId atual; não fica
 * preso ao ciclo de vida da sessão (que pode ser excluída/recriada a qualquer
 * momento) — o gestor escolhe explicitamente (tela de Vincular) qual agente
 * mover pra cá, identificado pelo seu whatsappConnectionId antigo.
 */
export function migrateAgentConfigByOldConnectionId(
  clientId: string,
  oldConnectionId: string,
  newConnectionId: string
): boolean {
  const client = getClients().find((c) => c.id === clientId);
  if (!client) return false;

  const configs = client.agentConfigs ?? [];
  const idx = configs.findIndex((c) => c.whatsappConnectionId === oldConnectionId);
  if (idx >= 0) {
    const newConfigs = [...configs];
    newConfigs[idx] = { ...newConfigs[idx], whatsappConnectionId: newConnectionId };
    upsertClient({ ...client, agentConfigs: newConfigs });
    return true;
  }

  if (client.agentConfig?.whatsappConnectionId === oldConnectionId) {
    upsertClient({ ...client, agentConfig: { ...client.agentConfig, whatsappConnectionId: newConnectionId } });
    return true;
  }

  return false;
}

/** Retorna todos os agentConfigs do cliente, sem duplicatas.
 *  Se agentConfigs[] existe e tem entradas, usa somente ele (ignora o legado agentConfig).
 *  Caso contrário, cai no agentConfig único como fallback. */
export function getAllAgentConfigs(client: Client): AgentConfig[] {
  const raw = (client.agentConfigs && client.agentConfigs.length > 0)
    ? [...client.agentConfigs]
    : (client.agentConfig ? [client.agentConfig] : []);

  // Se algum entry tem whatsappConnectionId, descarta os que não têm (são entradas órfãs/legado)
  const withConn = raw.filter((cfg) => !!cfg.whatsappConnectionId);
  const source = withConn.length > 0 ? withConn : raw;

  // Deduplica por whatsappConnectionId, depois por name como fallback
  const seenConn = new Set<string>();
  const seenName = new Set<string>();
  return source.filter((cfg) => {
    if (cfg.whatsappConnectionId) {
      if (seenConn.has(cfg.whatsappConnectionId)) return false;
      seenConn.add(cfg.whatsappConnectionId);
    } else if (cfg.name) {
      if (seenName.has(cfg.name)) return false;
      seenName.add(cfg.name);
    }
    return true;
  });
}

export function getClientByEmail(email: string): Client | undefined {
  return getClients().find((c) => c.email.toLowerCase() === email.toLowerCase());
}

export function saveClients(clients: Client[]) {
  ensureDataDir();
  writeFileSync(
    path.join(DATA_DIR, "clients.json"),
    JSON.stringify({ clients }, null, 2)
  );
}

export function upsertClient(client: Client) {
  const all = getClients();
  const idx = all.findIndex((c) => c.id === client.id);
  if (idx >= 0) all[idx] = client;
  else all.push(client);
  saveClients(all);
}

export function deleteClient(id: string) {
  saveClients(getClients().filter((c) => c.id !== id));
}

const DEFAULT_CONFIG: AppConfig = {
  manager: { email: process.env.MANAGER_EMAIL ?? "admin@trafegopago.com", passwordHash: "" },
  metaToken: "",
};

export function getConfig(): AppConfig {
  const cfg = readJsonFile<AppConfig>("config.json", DEFAULT_CONFIG);
  // Garante que manager sempre existe (volume vazio ou config corrompida)
  if (!cfg.manager) cfg.manager = DEFAULT_CONFIG.manager;
  return cfg;
}

export function saveConfig(config: AppConfig) {
  ensureDataDir();
  writeFileSync(path.join(DATA_DIR, "config.json"), JSON.stringify(config, null, 2));
}
