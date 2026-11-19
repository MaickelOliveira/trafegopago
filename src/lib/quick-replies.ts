import { readDocument, writeDocument, withDataTransaction } from "./document-store";
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

async function load(): Promise<Store> {
  return (await readDocument<Store>("quick-replies.json", {}));
}

async function persist(store: Store) {
  await writeDocument("quick-replies.json", store);
}

export async function getQuickReplies(clientId: string): Promise<QuickReply[]> {
  return (await load())[clientId] ?? [];
}

export async function createQuickReply(
  clientId: string,
  data: Omit<QuickReply, "id">,
): Promise<QuickReply> {
  return withDataTransaction(async () => {
  const store = (await load());
  const reply: QuickReply = { id: randomUUID(), ...data };
  store[clientId] = [...(store[clientId] ?? []), reply];
  (await persist(store));
  return reply;

  });
}

export async function updateQuickReply(
  clientId: string,
  id: string,
  data: Partial<Omit<QuickReply, "id">>,
): Promise<QuickReply | null> {
  return withDataTransaction(async () => {
  const store = (await load());
  const list = store[clientId] ?? [];
  const idx = list.findIndex((r) => r.id === id);
  if (idx === -1) return null;
  list[idx] = { ...list[idx], ...data };
  store[clientId] = list;
  (await persist(store));
  return list[idx];

  });
}

export async function deleteQuickReply(clientId: string, id: string): Promise<boolean> {
  return withDataTransaction(async () => {
  const store = (await load());
  const list = store[clientId] ?? [];
  const filtered = list.filter((r) => r.id !== id);
  if (filtered.length === list.length) return false;
  store[clientId] = filtered;
  (await persist(store));
  return true;

  });
}
