import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import path from "path";
import { randomUUID } from "crypto";

export type FieldMapping = {
  nameField: string;    // campo do payload que contém o nome do lead
  phoneField: string;   // campo do payload que contém o telefone
  emailField?: string;  // opcional
};

export type WebhookConfig = {
  id: string;
  clientId: string;
  funnelId: string;
  columnId: string;      // coluna do kanban onde o lead entra
  name: string;          // rótulo para identificar (ex: "Página de Vendas Principal")
  fieldMapping: FieldMapping;
  leadCount: number;
  active: boolean;
  createdAt: string;
};

const FILE = path.join(process.cwd(), "data", "webhooks.json");

function load(): WebhookConfig[] {
  try {
    if (!existsSync(FILE)) return [];
    return JSON.parse(readFileSync(FILE, "utf-8"));
  } catch {
    return [];
  }
}

function save(items: WebhookConfig[]) {
  const dir = path.dirname(FILE);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(FILE, JSON.stringify(items, null, 2));
}

export function getWebhooks(clientId?: string): WebhookConfig[] {
  const all = load();
  return clientId ? all.filter((w) => w.clientId === clientId) : all;
}

export function getWebhookById(id: string): WebhookConfig | undefined {
  return load().find((w) => w.id === id);
}

export function createWebhook(data: Omit<WebhookConfig, "id" | "leadCount" | "createdAt">): WebhookConfig {
  const items = load();
  const wh: WebhookConfig = {
    ...data,
    id: randomUUID(),
    leadCount: 0,
    createdAt: new Date().toISOString(),
  };
  items.push(wh);
  save(items);
  return wh;
}

export function incrementWebhookCount(id: string) {
  const items = load();
  const idx = items.findIndex((w) => w.id === id);
  if (idx >= 0) {
    items[idx].leadCount += 1;
    save(items);
  }
}

export function deleteWebhook(id: string): boolean {
  const items = load();
  const filtered = items.filter((w) => w.id !== id);
  if (filtered.length === items.length) return false;
  save(filtered);
  return true;
}
