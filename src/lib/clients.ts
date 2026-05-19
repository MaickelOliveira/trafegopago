import { readFileSync, writeFileSync } from "fs";
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

export type AgentConfig = {
  enabled: boolean;              // Liga/desliga o agente
  followUpEnabled: boolean;      // Liga/desliga follow-ups separadamente
  geminiApiKey?: string;         // Chave Gemini (sobrescreve a global se preenchida)
  googleCalendarId?: string;     // Calendar ID do cliente (ex: "primary")
  googleRefreshToken?: string;   // OAuth refresh token do Google Calendar
  summaryPhone?: string;         // Número para receber resumo de conversa
  followUps: FollowUpStep[];     // Sequência de follow-ups configurados
  systemPrompt?: string;         // Instruções do agente para este cliente
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
  uazapiToken?: string;
  uazapiWebhookForward?: string;
  appBaseUrl?: string;
  anthropicApiKey?: string;
  geminiApiKey?: string;         // Chave global do Gemini (usada quando cliente não tem a própria)
  googleClientId?: string;       // Google OAuth client ID (para Google Calendar)
  googleClientSecret?: string;   // Google OAuth client secret
  agentCronSecret?: string;      // Secret para proteger o endpoint de cron
};

const DATA_DIR = path.join(process.cwd(), "data");

export function getClients(): Client[] {
  const raw = readFileSync(path.join(DATA_DIR, "clients.json"), "utf-8");
  return JSON.parse(raw).clients as Client[];
}

export function getClientById(id: string): Client | undefined {
  return getClients().find((c) => c.id === id);
}

export function getClientByEmail(email: string): Client | undefined {
  return getClients().find((c) => c.email.toLowerCase() === email.toLowerCase());
}

export function saveClients(clients: Client[]) {
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

export function getConfig(): AppConfig {
  const raw = readFileSync(path.join(DATA_DIR, "config.json"), "utf-8");
  return JSON.parse(raw) as AppConfig;
}

export function saveConfig(config: AppConfig) {
  writeFileSync(path.join(DATA_DIR, "config.json"), JSON.stringify(config, null, 2));
}
