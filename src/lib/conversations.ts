import { readRecordMap, writeRecordMap } from "./record-store";
import { withDataTransaction } from "./document-store";
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
  aiContextResetAt?: number;
  _messageCount?: number;
};

type ConversationStore = Record<string, Conversation>;

const FILE = path.join(process.cwd(), "data", "conversations.json");
const MAX_MESSAGES = 200;
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 dias


async function load(clientId?: string, phone?: string, connId?: string, summary = false, limit?: number): Promise<ConversationStore> {
  return readRecordMap<Conversation>("conversations.json", { ...(clientId ? { clientId } : {}), ...(phone ? { phone } : {}), ...(connId ? { connId } : {}) }, { summary, limit });
}
const save = (data: ConversationStore) => writeRecordMap("conversations.json", data);

/** Gera variantes prefixadas por clientId para isolamento de histórico entre clientes */
function clientPhoneVariants(phone: string, clientId: string): string[] {
  return phoneVariants(phone).map((v) => `${clientId}:${v}`);
}


/** Unowned legacy records remain stored, but are never shown to another account. */
function scopedKeys(all: ConversationStore, phone: string, clientId?: string | null, connId?: string | null): string[] {
  if (!clientId) return [];
  const variants = new Set(phoneVariants(phone));
  const matches = Object.keys(all).filter(key => {
    const conversation = all[key];
    if (conversation.clientId && conversation.clientId !== clientId) return false;
    if (conversation.clientId !== clientId && !key.startsWith(clientId + ":")) return false;
    if (!variants.has(key.split(":").at(-1)!)) return false;
    const connection = key.startsWith(clientId + ":") && key.split(":").length >= 3 ? key.split(":").slice(1, -1).join(":") : conversation.connId;
    return !connId || connection === connId;
  });
  if (!connId && new Set(matches.map(key => all[key].connId ?? (key.split(":").length >= 3 ? key.split(":").slice(1,-1).join(":") : ""))).size > 1) return [];
  return matches.sort((a,b) => Number(b.startsWith(clientId + ":")) - Number(a.startsWith(clientId + ":")) || all[b].lastActivity - all[a].lastActivity);
}

export async function getHistory(phone: string, clientId?: string | null, connId?: string | null): Promise<ChatMessage[]> {
  if (!clientId) return [];
  const all = await load(clientId ?? undefined, phone, connId ?? undefined);
  const key = scopedKeys(all, phone, clientId, connId)[0];
  const conversation = key ? all[key] : undefined;
  if (!conversation || Date.now() - conversation.lastActivity > MAX_AGE_MS) return [];
  return conversation.messages;
}

export async function getClientId(phone: string): Promise<string | null> {
  const all = (await load(undefined, phone));
  const variants = new Set(phoneVariants(phone));
  const owners = new Set(Object.entries(all).filter(([key,conv]) => conv.clientId && variants.has(key.split(":").at(-1)!)).map(([,conv]) => conv.clientId));
  return owners.size === 1 ? [...owners][0] : null;
}

/** Debug: retorna amostra de chaves brutas de conversations.json para diagnóstico */
export async function debugGetRawKeys(limit = 20): Promise<string[]> {
  return Object.keys((await load(undefined, undefined, undefined, true, limit))).slice(0, limit);
}

export async function getAllConversationsByClientId(clientId: string): Promise<Array<{
  phone: string;
  contactName: string | null;
  connId: string | null;
  lastMessage: ChatMessage | null;
  lastActivity: number;
  unread: boolean;
  aiPaused: boolean;
  messageCount: number;
}>> {
  const all = (await load(clientId, undefined, undefined, true));
  const result = [];
  const prefix = `${clientId}:`;
  for (const [key, conv] of Object.entries(all)) {
    // Inclui se clientId bate explicitamente, se a chave tem o prefixo do cliente,
    // ou se clientId não foi registrado (conversas antigas antes do isolamento — o
    // filtro por connId na camada de API garante a separação entre clientes)
    const belongs =
      conv.clientId === clientId ||
      key.startsWith(prefix) && !conv.clientId;
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
      messageCount: conv._messageCount ?? conv.messages.length,
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

export async function markAsRead(phone: string, clientId?: string | null, connId?: string | null) {
  await withDataTransaction(async () => {
    const all = await load(clientId ?? undefined, phone, connId ?? undefined); let changed = false;
    for (const key of scopedKeys(all, phone, clientId, connId)) {
      if (all[key].unread) { all[key].unread = false; changed = true; }
    }
    if (changed) await save(all);
  });
}

/** Garante o código do país (55) na frente do número — usado só pra montar
 *  links wa.me legíveis por humano (ex: aviso no grupo de avisos). Sem o 55,
 *  o WhatsApp não reconhece o link como um contato válido. Diferente de
 *  phoneVariants() (que gera várias variantes pra busca fuzzy), aqui queremos
 *  UM número específico — mantém os dígitos exatamente como vieram (não mexe
 *  no 9º dígito), só garante o prefixo do país. */
export function ensureBrCountryCode(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  return digits.startsWith("55") ? digits : `55${digits}`;
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

export async function setAiPaused(phone: string, paused: boolean, clientId?: string | null, connId?: string | null) {
  await withDataTransaction(async () => {
    const all = await load(clientId ?? undefined, phone, connId ?? undefined); let changed = false;
    for (const key of scopedKeys(all, phone, clientId, connId)) {
      if (all[key].aiPaused !== paused) { all[key].aiPaused = paused; changed = true; }
    }
    if (changed) await save(all);
  });
}

export async function getAiPaused(phone: string, clientId?: string | null, connId?: string | null): Promise<boolean> {
  const all = await load(clientId ?? undefined, phone, connId ?? undefined);
  return scopedKeys(all, phone, clientId, connId).some(key => all[key].aiPaused === true);
}

/**
 * "Reseta o contexto da IA" pra um lead — usado pelo gestor durante testes,
 * quando a IA está reagindo com base em mensagens antigas da conversa e o
 * gestor quer que ela ignore tudo antes de agora. NÃO apaga nenhuma mensagem
 * — a conversa continua inteira no chat/inbox. Só marca um timestamp que
 * runGeminiAgent (gemini-agent.ts) usa pra filtrar o histórico que a IA
 * efetivamente recebe como contexto, sem mexer no que é exibido na tela.
 */
export async function resetAiContext(phone: string, clientId?: string | null, connId?: string | null): Promise<number> {
  return withDataTransaction(async () => {
    const all = await load(clientId ?? undefined, phone, connId ?? undefined); const now = Date.now();
    const keys = scopedKeys(all, phone, clientId, connId);
    for (const key of keys) all[key].aiContextResetAt = now;
    if (keys.length) await save(all);
    return now;
  });
}

export async function getAiContextResetAt(phone: string, clientId?: string | null, connId?: string | null): Promise<number> {
  const all = await load(clientId ?? undefined, phone, connId ?? undefined);
  return Math.max(0, ...scopedKeys(all, phone, clientId, connId).map(key => all[key].aiContextResetAt ?? 0));
}

export async function addMessage(
  phone: string,
  msg: ChatMessage,
  clientId: string | null,
  opts?: { connId?: string; contactName?: string }
) {
  return withDataTransaction(async () => {
  const all = (await load(clientId ?? undefined, phone, opts?.connId));
  const connIdVal = opts?.connId;
  // Chave padrão: inclui connId quando disponível para isolar histórico por conexão
  const defaultKey = clientId
    ? (connIdVal ? `${clientId}:${connIdVal}:${phone}` : `${clientId}:${phone}`)
    : phone;
  // Procura chave existente: primeiro isolada por conexão (testando variantes do telefone,
  // pois quem chama pode passar o telefone em formato diferente do usado pelo webhook
  // que originou a conversa), depois com prefixo clientId, depois sem prefixo
  if (!clientId) throw new Error("Cliente obrigatório para salvar uma conversa.");
  const existingKey = scopedKeys(all, phone, clientId, connIdVal)[0] ?? defaultKey;
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
  (await save(all));

  });
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
export async function updateLastMessage(phone: string, patch: Partial<ChatMessage>, clientId?: string | null, connId?: string | null) {
  await withDataTransaction(async () => {
    const all = await load(clientId ?? undefined, phone, connId ?? undefined);
    const key = scopedKeys(all, phone, clientId, connId)[0];
    if (!key || !all[key].messages.length) return;
    Object.assign(all[key].messages[all[key].messages.length - 1], patch);
    await save(all);
  });
}
