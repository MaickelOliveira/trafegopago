/**
 * Batching de mensagens — acumula mensagens do mesmo contato
 * e responde de uma vez após a janela de espera configurada.
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import path from "path";
import { randomUUID } from "crypto";

export type PendingResponse = {
  id: string;
  clientId: string;
  phone: string;
  messages: string[];       // mensagens acumuladas
  respondAfter: string;     // ISO — quando processar
  status: "pending" | "processing" | "done";
  createdAt: string;
  updatedAt: string;
};

const FILE = path.join(process.cwd(), "data", "pending-responses.json");

function load(): PendingResponse[] {
  try {
    if (!existsSync(FILE)) return [];
    return JSON.parse(readFileSync(FILE, "utf-8"));
  } catch {
    return [];
  }
}

function save(items: PendingResponse[]) {
  writeFileSync(FILE, JSON.stringify(items, null, 2));
}

// Se o setTimeout in-process de um batch se perder (ex: restart do servidor
// antes de disparar), o registro fica "pending" para sempre no arquivo — sem
// isso, uma mensagem NOVA e completamente sem relação, chegando horas ou dias
// depois, seria silenciosamente concatenada com esse texto antigo e enviada
// junto ao Gemini como se fosse tudo uma única mensagem atual.
const STALE_PENDING_MS = 10 * 60 * 1000; // 10 minutos após o respondAfter original

export function upsertPending(
  clientId: string,
  phone: string,
  newMessage: string,
  waitSeconds: number
): PendingResponse {
  const items = load();
  const now = new Date();
  const respondAfter = new Date(now.getTime() + waitSeconds * 1000).toISOString();

  const idx = items.findIndex(
    (p) => p.clientId === clientId && p.phone === phone && p.status === "pending"
  );

  if (idx >= 0) {
    const isStale = now.getTime() - new Date(items[idx].respondAfter).getTime() > STALE_PENDING_MS;
    if (isStale) {
      // Batch abandonado (timer perdido) — descarta em vez de misturar com a mensagem nova
      items[idx].status = "done";
    } else {
      // Estende deadline e acumula mensagem
      items[idx].messages.push(newMessage);
      items[idx].respondAfter = respondAfter;
      items[idx].updatedAt = now.toISOString();
      save(items);
      return items[idx];
    }
  }

  const item: PendingResponse = {
    id: randomUUID(),
    clientId,
    phone,
    messages: [newMessage],
    respondAfter,
    status: "pending",
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
  items.push(item);
  save(items);
  return item;
}

export function getDuePending(): PendingResponse[] {
  const now = new Date();
  return load().filter(
    (p) => p.status === "pending" && new Date(p.respondAfter) <= now
  );
}

export function getPendingForPhone(clientId: string, phone: string): PendingResponse | undefined {
  return load().find(
    (p) => p.clientId === clientId && p.phone === phone && p.status === "pending"
  );
}

export function markProcessing(id: string): void {
  const items = load();
  const idx = items.findIndex((p) => p.id === id);
  if (idx >= 0) { items[idx].status = "processing"; save(items); }
}

export function markDone(id: string): void {
  const items = load();
  const idx = items.findIndex((p) => p.id === id);
  if (idx >= 0) { items[idx].status = "done"; save(items); }
}

export function cancelPendingForPhone(clientId: string, phone: string): void {
  const items = load();
  let changed = false;
  for (const p of items) {
    if (p.clientId === clientId && p.phone === phone && p.status === "pending") {
      p.status = "done";
      changed = true;
    }
  }
  if (changed) save(items);
}
