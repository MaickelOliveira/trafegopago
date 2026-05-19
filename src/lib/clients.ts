import { readFileSync, writeFileSync } from "fs";
import path from "path";
import type { AutomationsConfig } from "./automations";

export type AdAccount = {
  id: string;
  name: string;
  platform: "meta" | "google";
};

export type FunnelType = "leads" | "sales" | "traffic";

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
  agentPrompt?: string;         // Instruções customizadas para o agente de WhatsApp deste cliente
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
