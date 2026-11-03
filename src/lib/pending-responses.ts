import { readRecordList, writeRecordList, type RecordFilter } from "./record-store";
import { withDataTransaction } from "./document-store";
/**
 * Batching de mensagens — acumula mensagens do mesmo contato
 * e responde de uma vez após a janela de espera configurada.
 */

import path from "path";
import { randomUUID } from "crypto";
import { normalizePhone } from "./leads";

export type PendingResponse = {
  id: string;
  clientId: string;
  phone: string;
  connId?: string;
  processingAt?: string;
  messages: string[];       // mensagens acumuladas
  respondAfter: string;     // ISO — quando processar
  status: "pending" | "processing" | "done";
  createdAt: string;
  updatedAt: string;
};

const FILE = path.join(process.cwd(), "data", "pending-responses.json");

const load = (filter?: RecordFilter, options?: Parameters<typeof readRecordList>[2]) => readRecordList<PendingResponse>("pending-responses.json", filter, options);

const save = (items: PendingResponse[]) => writeRecordList("pending-responses.json", items);

// Se o setTimeout in-process de um batch se perder (ex: restart do servidor
// antes de disparar), o registro fica "pending" para sempre no arquivo — sem
// isso, uma mensagem NOVA e completamente sem relação, chegando horas ou dias
// depois, seria silenciosamente concatenada com esse texto antigo e enviada
// junto ao Gemini como se fosse tudo uma única mensagem atual.
const STALE_PENDING_MS = 10 * 60 * 1000; // 10 minutos após o respondAfter original

export async function upsertPending(
  clientId: string,
  phone: string,
  newMessage: string,
  waitSeconds: number,
  connId?: string
): Promise<PendingResponse> {
  return withDataTransaction(async () => {
  if (!Number.isFinite(waitSeconds) || waitSeconds < 0 || waitSeconds > 3600) throw new Error("Tempo de espera inválido.");
  const items = (await load({ clientId, phone, connId: connId ?? null, status: "pending" }));
  const now = new Date();
  const respondAfter = new Date(now.getTime() + waitSeconds * 1000).toISOString();

  const idx = items.findIndex(
    (p) => p.clientId === clientId && normalizePhone(p.phone) === normalizePhone(phone) && p.connId === connId && p.status === "pending"
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
      (await save(items));
      return items[idx];
    }
  }

  const item: PendingResponse = {
    id: randomUUID(),
    clientId,
    phone: normalizePhone(phone),
    connId,
    messages: [newMessage],
    respondAfter,
    status: "pending",
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
  items.push(item);
  (await save(items));
  return item;

  });
}

export async function getDuePending(): Promise<PendingResponse[]> {
  const now = new Date();
  return (await load({ status: "pending" }, { before: { field: "respondAfter", value: new Date().toISOString() }, limit: 20 })).filter(
    (p) => p.status === "pending" && new Date(p.respondAfter) <= now
  );
}

export async function getPendingForPhone(clientId: string, phone: string, connId?: string): Promise<PendingResponse | undefined> {
  return (await load({ clientId, phone, connId: connId ?? null, status: "pending" })).find(
    (p) => p.clientId === clientId && normalizePhone(p.phone) === normalizePhone(phone) && p.connId === connId && p.status === "pending"
  );
}

export async function markProcessing(id: string): Promise<boolean> {
  return withDataTransaction(async () => {
  const items = (await load({ id }));
  const idx = items.findIndex((p) => p.id === id);
  if (idx < 0 || items[idx].status !== "pending" || Date.parse(items[idx].respondAfter) > Date.now()) return false;
  items[idx].status = "processing";
  items[idx].processingAt = new Date().toISOString();
  await save(items);
  return true;

  });
}

export async function markDone(id: string): Promise<void> {
  return withDataTransaction(async () => {
  const items = (await load({ id }));
  const idx = items.findIndex((p) => p.id === id);
  if (idx >= 0) { items[idx].status = "done"; (await save(items)); }

  });
}

export async function cancelPendingForPhone(clientId: string, phone: string, connId?: string): Promise<void> {
  return withDataTransaction(async () => {
  const items = (await load({ clientId, phone, ...(connId === undefined ? {} : { connId }), status: ["pending", "processing"] }));
  let changed = false;
  for (const p of items) {
    if (p.clientId === clientId && normalizePhone(p.phone) === normalizePhone(phone) && (connId === undefined || p.connId === connId) && ["pending", "processing"].includes(p.status)) {
      p.status = "done";
      changed = true;
    }
  }
  if (changed) (await save(items));

  });
}
