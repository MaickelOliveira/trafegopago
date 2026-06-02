import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { randomUUID } from "crypto";

export interface QuickReply {
  id: string;
  shortcut: string;  // ex: "oi", "preco", "obg"
  title: string;     // nome de exibição
  text: string;      // texto da mensagem
  imageUrl?: string; // URL de imagem opcional
}

type Store = Record<string, QuickReply[]>;

const FILE = join(process.cwd(), "data", "quick-replies.json");

function load(): Store {
  if (!existsSync(FILE)) return {};
  try { return JSON.parse(readFileSync(FILE, "utf-8")); } catch { return {}; }
}

function persist(store: Store) {
  writeFileSync(FILE, JSON.stringify(store, null, 2), "utf-8");
}

export function getQuickReplies(clientId: string): QuickReply[] {
  return load()[clientId] ?? [];
}

export function createQuickReply(
  clientId: string,
  data: Omit<QuickReply, "id">,
): QuickReply {
  const store = load();
  const reply: QuickReply = { id: randomUUID(), ...data };
  store[clientId] = [...(store[clientId] ?? []), reply];
  persist(store);
  return reply;
}

export function updateQuickReply(
  clientId: string,
  id: string,
  data: Partial<Omit<QuickReply, "id">>,
): QuickReply | null {
  const store = load();
  const list = store[clientId] ?? [];
  const idx = list.findIndex((r) => r.id === id);
  if (idx === -1) return null;
  list[idx] = { ...list[idx], ...data };
  store[clientId] = list;
  persist(store);
  return list[idx];
}

export function deleteQuickReply(clientId: string, id: string): boolean {
  const store = load();
  const list = store[clientId] ?? [];
  const filtered = list.filter((r) => r.id !== id);
  if (filtered.length === list.length) return false;
  store[clientId] = filtered;
  persist(store);
  return true;
}
