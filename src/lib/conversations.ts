import { readFileSync, writeFileSync, existsSync } from "fs";
import path from "path";

export type ChatMessage = { role: "user" | "assistant"; content: string; ts: number };

type Conversation = {
  messages: ChatMessage[];
  clientId: string | null;
  lastActivity: number;
};

type ConversationStore = Record<string, Conversation>;

const FILE = path.join(process.cwd(), "data", "conversations.json");
const MAX_MESSAGES = 200;
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 dias

function load(): ConversationStore {
  try {
    if (!existsSync(FILE)) return {};
    return JSON.parse(readFileSync(FILE, "utf-8"));
  } catch {
    return {};
  }
}

function save(data: ConversationStore) {
  writeFileSync(FILE, JSON.stringify(data, null, 2));
}

export function getHistory(phone: string): ChatMessage[] {
  const all = load();
  const conv = all[phone];
  if (!conv) return [];
  if (Date.now() - conv.lastActivity > MAX_AGE_MS) return [];
  return conv.messages;
}

export function getClientId(phone: string): string | null {
  return load()[phone]?.clientId ?? null;
}

export function addMessage(phone: string, msg: ChatMessage, clientId: string | null) {
  const all = load();
  const conv: Conversation = all[phone] ?? { messages: [], clientId, lastActivity: 0 };
  conv.messages.push(msg);
  if (conv.messages.length > MAX_MESSAGES) {
    conv.messages = conv.messages.slice(-MAX_MESSAGES);
  }
  conv.lastActivity = Date.now();
  conv.clientId = clientId;
  all[phone] = conv;
  save(all);
}
