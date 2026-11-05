import { readDocument, writeDocument, withDataTransaction } from "./document-store";
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

async function load(): Promise<WebhookConfig[]> {
  return (await readDocument<WebhookConfig[]>("webhooks.json", []));
}

async function save(items: WebhookConfig[]) {
  await writeDocument("webhooks.json", items);
}

export async function getWebhooks(clientId?: string): Promise<WebhookConfig[]> {
  const all = (await load());
  return clientId ? all.filter((w) => w.clientId === clientId) : all;
}

export async function getWebhookById(id: string): Promise<WebhookConfig | undefined> {
  return (await load()).find((w) => w.id === id);
}

export async function createWebhook(data: Omit<WebhookConfig, "id" | "leadCount" | "createdAt">): Promise<WebhookConfig> {
  return withDataTransaction(async () => {
  const items = (await load());
  const wh: WebhookConfig = {
    ...data,
    id: randomUUID(),
    leadCount: 0,
    createdAt: new Date().toISOString(),
  };
  items.push(wh);
  (await save(items));
  return wh;

  });
}

export async function incrementWebhookCount(id: string) {
  return withDataTransaction(async () => {
  const items = (await load());
  const idx = items.findIndex((w) => w.id === id);
  if (idx >= 0) {
    items[idx].leadCount += 1;
    (await save(items));
  }

  });
}

export async function deleteWebhook(id: string): Promise<boolean> {
  return withDataTransaction(async () => {
  const items = (await load());
  const filtered = items.filter((w) => w.id !== id);
  if (filtered.length === items.length) return false;
  (await save(filtered));
  return true;

  });
}
