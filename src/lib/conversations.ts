import { readFileSync, writeFileSync, existsSync, statSync } from "fs";
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

// Cache em memória — só relê o disco quando o arquivo muda (mtime)
let _cache: ConversationStore | null = null;
let _cacheMtime = 0;

function load(): ConversationStore {
  try {
    if (!existsSync(FILE)) return {};
    const mtime = statSync(FILE).mtimeMs;
    if (_cache && mtime === _cacheMtime) return _cache;
    const parsed = JSON.parse(readFileSync(FILE, "utf-8"));
    _cache = Array.isArray(parsed) ? {} : parsed;
    _cacheMtime = mtime;
    return _cache!;
  } catch {
    return {};
  }
}

function save(data: ConversationStore) {
  writeFileSync(FILE, JSON.stringify(data, null, 2));
  // Atualiza cache imediatamente para evitar releitura desnecessária
  _cache = data;
  try { _cacheMtime = statSync(FILE).mtimeMs; } catch { /* ignore */ }
}

/** Gera variantes prefixadas por clientId para isolamento de histórico entre clientes */
function clientPhoneVariants(phone: string, clientId: string): string[] {
  return phoneVariants(phone).map((v) => `${clientId}:${v}`);
}

export function getHistory(phone: string, clientId?: string | null, connId?: string | null): ChatMessage[] {
  const all = load();
  // Se connId fornecido, tenta chave isolada por conexão com todas as variantes de telefone
  // (webhook armazena com +55, lead pode ter sem — ambos devem bater)
  if (clientId && connId) {
    for (const v of phoneVariants(phone)) {
      const connKey = `${clientId}:${connId}:${v}`;
      const conv = all[connKey];
      if (conv) {
        if (Date.now() - conv.lastActivity > MAX_AGE_MS) return [];
        return conv.messages;
      }
    }
  }
  // Se clientId fornecido, tenta chaves prefixadas (clientId:phone)
  if (clientId) {
    for (const v of clientPhoneVariants(phone, clientId)) {
      const conv = all[v];
      if (conv) {
        if (Date.now() - conv.lastActivity > MAX_AGE_MS) return [];
        return conv.messages;
      }
    }
  }
  // Fallback: chaves sem prefixo (dados antigos ou sem clientId)
  for (const v of phoneVariants(phone)) {
    const conv = all[v];
    if (conv) {
      if (clientId && conv.clientId && conv.clientId !== clientId) continue;
      if (Date.now() - conv.lastActivity > MAX_AGE_MS) return [];
      return conv.messages;
    }
  }
  return [];
}

export function getClientId(phone: string): string | null {
  const all = load();
  // 1. Chaves simples (formato antigo)
  for (const v of phoneVariants(phone)) {
    if (all[v]?.clientId) return all[v]?.clientId ?? null;
  }
  // 2. Chaves prefixadas (formato novo: clientId:phone)
  const variants = phoneVariants(phone);
  for (const [key, conv] of Object.entries(all)) {
    if (!key.includes(":")) continue;
    const phonePart = key.slice(key.indexOf(":") + 1);
    if (variants.includes(phonePart) && conv.clientId) return conv.clientId;
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
  const prefix = `${clientId}:`;
  for (const [key, conv] of Object.entries(all)) {
    // Inclui se clientId bate explicitamente, se a chave tem o prefixo do cliente,
    // ou se clientId não foi registrado (conversas antigas antes do isolamento — o
    // filtro por connId na camada de API garante a separação entre clientes)
    const belongs =
      conv.clientId === clientId ||
      key.startsWith(prefix) ||
      conv.clientId == null;
    if (!belongs) continue;
    if (Date.now() - conv.lastActivity > MAX_AGE_MS) continue;
    // Remove prefixo clientId: da chave para obter o restante
    let phone = key.startsWith(prefix) ? key.slice(prefix.length) : key;
    // Chaves no formato clientId:connId:phone — remove também o connId do início
    const convConnId = conv.connId ?? null;
    // isIsolated = connId está NA chave (não só no objeto) → conversa isolada por conexão
    let isIsolated = false;
    if (convConnId && phone.startsWith(convConnId + ":")) {
      phone = phone.slice(convConnId.length + 1);
      isIsolated = true;
    }
    const lastMessage = conv.messages.length > 0 ? conv.messages[conv.messages.length - 1] : null;
    result.push({
      phone,
      contactName: conv.contactName ?? null,
      connId: convConnId,
      lastMessage,
      lastActivity: conv.lastActivity,
      unread: conv.unread ?? false,
      aiPaused: conv.aiPaused ?? false,
      _isolated: isIsolated,
    });
  }
  // Deduplica por (phone, connId): chave isolada sempre vence a legada;
  // entre iguais mantém a mais recente.
  const deduped = new Map<string, (typeof result)[0]>();
  for (const c of result) {
    const dk = `${c.connId ?? ""}:${c.phone}`;
    const existing = deduped.get(dk);
    if (!existing) {
      deduped.set(dk, c);
    } else if (c._isolated && !existing._isolated) {
      deduped.set(dk, c); // chave isolada sempre vence a legada mista
    } else if (!c._isolated && existing._isolated) {
      // legada perde para isolada — não substitui
    } else if (c.lastActivity > existing.lastActivity) {
      deduped.set(dk, c);
    }
  }
  return [...deduped.values()]
    .map(({ _isolated: _, ...rest }) => rest)
    .sort((a, b) => b.lastActivity - a.lastActivity);
}

export function markAsRead(phone: string, clientId?: string | null, connId?: string | null) {
  const all = load();
  // Tenta chave isolada por conexão com todas as variantes de telefone
  if (clientId && connId) {
    for (const v of phoneVariants(phone)) {
      const connKey = `${clientId}:${connId}:${v}`;
      if (all[connKey]) { all[connKey].unread = false; save(all); return; }
    }
  }
  // Tenta chave prefixada (clientId:phone)
  if (clientId) {
    for (const v of clientPhoneVariants(phone, clientId)) {
      if (all[v]) { all[v].unread = false; save(all); return; }
    }
  }
  // Fallback: chave sem prefixo
  for (const v of phoneVariants(phone)) {
    if (all[v]) { all[v].unread = false; save(all); return; }
  }
}

/** Normaliza telefone removendo código de país 55 para busca fuzzy */
export function phoneVariants(phone: string): string[] {
  const digits = phone.replace(/\D/g, "");

  // Obtém número local sem prefixo 55
  const local = digits.startsWith("55") && digits.length >= 12 ? digits.slice(2) : digits;

  const variants: string[] = [];

  if (local.length === 11 && local[2] === "9") {
    // Formato novo com 9º dígito: gera também o formato antigo sem 9
    // O formato com 55 vem SEMPRE PRIMEIRO (é o que UazAPI armazena)
    const sem9 = local.slice(0, 2) + local.slice(3); // remove o 9
    variants.push("55" + sem9);   // 12 dígitos sem 9 ← formato UazAPI mais comum
    variants.push("55" + local);  // 13 dígitos com 9
    variants.push(sem9);          // 10 dígitos sem 9
    variants.push(local);         // 11 dígitos com 9
  } else if (local.length === 10) {
    // Formato antigo sem 9º dígito
    variants.push("55" + local);  // 12 dígitos ← formato UazAPI mais comum
    variants.push(local);         // 10 dígitos
    // Se 3º dígito >= 6, tenta também com o 9
    if (/^[1-9]{2}[6-9]/.test(local)) {
      const com9 = local.slice(0, 2) + "9" + local.slice(2);
      variants.push("55" + com9); // 13 dígitos
      variants.push(com9);        // 11 dígitos
    }
  } else {
    variants.push("55" + local);
    variants.push(local);
  }

  // Garante que o dígito original está incluído e sem duplicatas
  return [...new Set([...variants, digits])];
}

export function setAiPaused(phone: string, paused: boolean, clientId?: string | null) {
  const all = load();
  let changed = false;
  // Atualiza chaves prefixadas se clientId fornecido
  if (clientId) {
    for (const v of clientPhoneVariants(phone, clientId)) {
      if (all[v]) { all[v].aiPaused = paused; changed = true; }
    }
  }
  // Também atualiza chaves sem prefixo (dados antigos)
  for (const v of phoneVariants(phone)) {
    if (all[v]) { all[v].aiPaused = paused; changed = true; }
  }
  if (changed) save(all);
}

export function getAiPaused(phone: string, clientId?: string | null): boolean {
  const all = load();
  if (clientId) {
    if (clientPhoneVariants(phone, clientId).some((v) => all[v]?.aiPaused === true)) return true;
  }
  return phoneVariants(phone).some((v) => all[v]?.aiPaused === true);
}

export function addMessage(
  phone: string,
  msg: ChatMessage,
  clientId: string | null,
  opts?: { connId?: string; contactName?: string }
) {
  const all = load();
  const connIdVal = opts?.connId;
  // Chave padrão: inclui connId quando disponível para isolar histórico por conexão
  const defaultKey = clientId
    ? (connIdVal ? `${clientId}:${connIdVal}:${phone}` : `${clientId}:${phone}`)
    : phone;
  // Procura chave existente: primeiro isolada por conexão (testando variantes do telefone,
  // pois quem chama pode passar o telefone em formato diferente do usado pelo webhook
  // que originou a conversa), depois com prefixo clientId, depois sem prefixo
  let existingKey: string | undefined;
  if (clientId && connIdVal) {
    existingKey = phoneVariants(phone)
      .map((v) => `${clientId}:${connIdVal}:${v}`)
      .find((k) => all[k]);
  }
  if (!existingKey && clientId) {
    existingKey = clientPhoneVariants(phone, clientId).find((v) => all[v]);
  }
  if (!existingKey) {
    // Só reutiliza chave sem prefixo se pertence ao mesmo clientId (evita contaminar)
    existingKey = phoneVariants(phone).find(
      (v) => all[v] && (!clientId || !all[v].clientId || all[v].clientId === clientId)
    );
  }
  existingKey = existingKey ?? defaultKey;
  const conv: Conversation = all[existingKey] ?? { messages: [], clientId, lastActivity: 0 };

  // Deduplicação: ignora mensagem idêntica com mesmo role em janela de 10s
  const DEDUP_MS = 10_000;
  const lastMsg = conv.messages[conv.messages.length - 1];
  if (lastMsg && lastMsg.role === msg.role && lastMsg.content === msg.content && Math.abs(msg.ts - lastMsg.ts) < DEDUP_MS) {
    return;
  }

  conv.messages.push(msg);
  if (conv.messages.length > MAX_MESSAGES) {
    conv.messages = conv.messages.slice(-MAX_MESSAGES);
  }
  conv.lastActivity = Date.now();
  conv.clientId = clientId;
  if (opts?.connId) conv.connId = opts.connId;
  // Proteção: só sobrescreve o nome se o novo nome for válido e o existente não for real
  if (opts?.contactName) {
    const sanitized = sanitizeContactName(opts.contactName, phone);
    const existingName = conv.contactName;
    const existingIsReal = existingName && existingName !== phone && !/^[\d\s+\-().]{7,}$/.test(existingName);
    if (sanitized && !existingIsReal) conv.contactName = sanitized;
  }
  // Marca como não lida quando chega mensagem do contato
  if (msg.role === "user") conv.unread = true;
  all[existingKey] = conv;
  save(all);
}

/**
 * Valida e sanitiza o nome de contato vindo de fontes externas (WhatsApp, webhooks).
 * Retorna undefined se o nome parecer um número de telefone, for muito longo ou vazio.
 * Use sempre antes de salvar um nome recebido automaticamente.
 */
export function sanitizeContactName(raw: string | null | undefined, phone?: string): string | undefined {
  if (!raw) return undefined;
  const s = raw.trim();
  if (!s) return undefined;
  // Parece número de telefone (só dígitos, espaços e símbolos telefônicos)
  if (/^[\d\s+\-().]{7,}$/.test(s)) return undefined;
  // Igual ao número de telefone → sem informação nova
  if (phone && s === phone) return undefined;
  // Muito longo → provavelmente erro de parsing (mensagem caiu no campo de nome)
  if (s.length > 80) return undefined;
  return s;
}

/** Atualiza a última mensagem de uma conversa (ex: substituir [audio] pela transcrição). */
export function updateLastMessage(phone: string, patch: Partial<ChatMessage>, clientId?: string | null) {
  const all = load();
  // Tenta chave prefixada primeiro para garantir isolamento por cliente
  const keys = clientId
    ? [...clientPhoneVariants(phone, clientId), ...phoneVariants(phone)]
    : phoneVariants(phone);
  for (const key of keys) {
    const conv = all[key];
    if (conv && conv.messages.length > 0) {
      Object.assign(conv.messages[conv.messages.length - 1], patch);
      save(all);
      return;
    }
  }
}
