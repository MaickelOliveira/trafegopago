import { readFileSync, writeFileSync, existsSync } from "fs";
import path from "path";

export type ChatMessage = { role: "user" | "assistant"; content: string; ts: number; type?: "text" | "audio" | "image"; mediaUrl?: string };

type Conversation = {
  messages: ChatMessage[];
  clientId: string | null;
  connId?: string | null;
  contactName?: string | null;
  lastActivity: number;
  unread?: boolean;
  aiPaused?: boolean;
};

type ConversationStore = Record<string, Conversation>;

const FILE = path.join(process.cwd(), "data", "conversations.json");
const MAX_MESSAGES = 200;
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 dias

function load(): ConversationStore {
  try {
    if (!existsSync(FILE)) return {};
    const parsed = JSON.parse(readFileSync(FILE, "utf-8"));
    // garante que seja objeto e não array
    return Array.isArray(parsed) ? {} : parsed;
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

export function getAllConversationsByClientId(clientId: string): Array<{
  phone: string;
  contactName: string | null;
  connId: string | null;
  lastMessage: ChatMessage | null;
  lastActivity: number;
  unread: boolean;
  aiPaused: boolean;
}> {
  const all = load();
  const result = [];
  for (const [phone, conv] of Object.entries(all)) {
    if (conv.clientId !== clientId) continue;
    if (Date.now() - conv.lastActivity > MAX_AGE_MS) continue;
    const lastMessage = conv.messages.length > 0 ? conv.messages[conv.messages.length - 1] : null;
    result.push({
      phone,
      contactName: conv.contactName ?? null,
      connId: conv.connId ?? null,
      lastMessage,
      lastActivity: conv.lastActivity,
      unread: conv.unread ?? false,
      aiPaused: conv.aiPaused ?? false,
    });
  }
  return result.sort((a, b) => b.lastActivity - a.lastActivity);
}

export function markAsRead(phone: string) {
  const all = load();
  if (all[phone]) {
    all[phone].unread = false;
    save(all);
  }
}

export function setAiPaused(phone: string, paused: boolean) {
  const all = load();
  if (all[phone]) {
    all[phone].aiPaused = paused;
    save(all);
  }
}

export function getAiPaused(phone: string): boolean {
  return load()[phone]?.aiPaused ?? false;
}

export function addMessage(
  phone: string,
  msg: ChatMessage,
  clientId: string | null,
  opts?: { connId?: string; contactName?: string }
) {
  const all = load();
  const conv: Conversation = all[phone] ?? { messages: [], clientId, lastActivity: 0 };
  conv.messages.push(msg);
  if (conv.messages.length > MAX_MESSAGES) {
    conv.messages = conv.messages.slice(-MAX_MESSAGES);
  }
  conv.lastActivity = Date.now();
  conv.clientId = clientId;
  if (opts?.connId) conv.connId = opts.connId;
  if (opts?.contactName) conv.contactName = opts.contactName;
  // Marca como não lida quando chega mensagem do contato
  if (msg.role === "user") conv.unread = true;
  all[phone] = conv;
  save(all);
}
