import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import path from "path";
import type { AutomationsConfig } from "./automations";

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

export type AgentConfig = {
  enabled: boolean;              // Liga/desliga o agente
  followUpEnabled: boolean;      // Liga/desliga follow-ups separadamente
  geminiApiKey?: string;         // Chave Gemini (sobrescreve a global se preenchida)
  googleCalendarId?: string;     // Calendar ID do cliente (ex: "primary")
  googleRefreshToken?: string;   // OAuth refresh token do Google Calendar
  summaryPhone?: string;         // Número para receber resumo de conversa
  followUps: FollowUpStep[];     // Sequência de follow-ups configurados
  systemPrompt?: string;         // Instruções do agente para este cliente
  whatsappConnectionId?: string; // ID da conexão WhatsApp que o agente usa
  messageWaitSeconds?: number;   // Segundos de espera para acumular mensagens (0 = desabilitado)
  mediaLibrary?: AgentMedia[];   // Fotos, vídeos e documentos que o agente pode disparar
  splitMessages?: boolean;       // Divide respostas longas em múltiplas mensagens
  maxMessageLength?: number;     // Máx. de caracteres por mensagem (padrão: 300)
};

export type Client = {
  id: string;
  name: string;
  email: string;
  passwordHash: string;
  color: string;
  cplTarget: number;
  funnelType: FunnelType;
  adAccounts: AdAccount[];
  whatsappPhone?: string;
  automations?: AutomationsConfig;
  tintimCode?: string;
  tintimToken?: string;
  tintimWebhookForward?: string;
  pixelId?: string;             // ID do pixel Meta (fbq browser + CAPI)
  capiToken?: string;           // Token de Conversão da API (gerado no Gerenciador de Eventos → Dataset)
  kanbanAgentEnabled?: boolean; // Agente IA de CRM ativo (default: true se anthropicApiKey configurado)
  agentConfig?: AgentConfig;    // Configuração do agente Gemini de WhatsApp
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
  googleClientId?: string;       // Google OAuth client ID (para Google Calendar)
  googleClientSecret?: string;   // Google OAuth client secret
  agentCronSecret?: string;      // Secret para proteger o endpoint de cron
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
