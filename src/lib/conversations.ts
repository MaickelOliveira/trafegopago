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
  for (const v of phoneVariants(phone)) {
    const conv = all[v];
    if (conv) {
      if (Date.now() - conv.lastActivity > MAX_AGE_MS) return [];
      return conv.messages;
    }
  }
  return [];
}

export function getClientId(phone: string): string | null {
  const all = load();
  for (const v of phoneVariants(phone)) {
    if (all[v]?.clientId) return all[v].clientId;
  }
  return null;
}

/** Debug: retorna amostra de chaves brutas de conversations.json para diagnóstico */
export function debugGetRawKeys(limit = 20): string[] {
  return Object.keys(load()).slice(0, limit);
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

/** Normaliza telefone removendo código de país 55 para busca fuzzy */
function phoneVariants(phone: string): string[] {
  const digits = phone.replace(/\D/g, "");
  const variants = new Set<string>([digits]);

  // Obtém o número local (sem prefixo 55)
  const local = digits.startsWith("55") && digits.length >= 12 ? digits.slice(2) : digits;

  // Sempre testa com e sem o prefixo 55
  variants.add(local);
  variants.add("55" + local);

  // Se local tem 11 dígitos e o 3º dígito é 9 (formato novo com 9º dígito):
  // também testa o formato antigo sem o 9 (10 dígitos locais = 12 com 55)
  if (local.length === 11 && local[2] === "9") {
    const sem9 = local.slice(0, 2) + local.slice(3); // remove o 9
    variants.add(sem9);
    variants.add("55" + sem9);
  }

  // Se local tem 10 dígitos e 3º dígito >= 6 (celular formato antigo):
  // também testa com o 9 adicionado (11 dígitos locais = 13 com 55)
  if (local.length === 10 && /^[1-9]{2}[6-9]/.test(local)) {
    const com9 = local.slice(0, 2) + "9" + local.slice(2);
    variants.add(com9);
    variants.add("55" + com9);
  }

  return [...variants];
}

export function setAiPaused(phone: string, paused: boolean) {
  const all = load();
  const variants = phoneVariants(phone);
  let changed = false;
  for (const v of variants) {
    if (all[v]) {
      all[v].aiPaused = paused;
      changed = true;
    }
  }
  if (changed) save(all);
}

export function getAiPaused(phone: string): boolean {
  const all = load();
  return phoneVariants(phone).some((v) => all[v]?.aiPaused === true);
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

/** Atualiza a última mensagem de uma conversa (ex: substituir [audio] pela transcrição). */
export function updateLastMessage(phone: string, patch: Partial<ChatMessage>) {
  const all = load();
  const conv = all[phone];
  if (!conv || conv.messages.length === 0) return;
  Object.assign(conv.messages[conv.messages.length - 1], patch);
  save(all);
}
