import { readFileSync, writeFileSync, existsSync } from "fs";
import path from "path";
import { randomUUID } from "crypto";

export type BroadcastStatus = "running" | "paused" | "completed" | "cancelled";

export type Broadcast = {
  id: string;
  clientId: string;
  name: string;
  message: string;
  connectionId: string; // EvolutionSession.id
  delaySeconds: number;
  status: BroadcastStatus;
  totalCount: number;
  sentCount: number;
  failedCount: number;
  createdAt: string;
  startedAt: string;
  finishedAt?: string;
};

const FILE = path.join(process.cwd(), "data", "broadcasts.json");

function load(): Broadcast[] {
  try {
    if (!existsSync(FILE)) return [];
    return JSON.parse(readFileSync(FILE, "utf-8"));
  } catch {
    return [];
  }
}

function save(items: Broadcast[]) {
  writeFileSync(FILE, JSON.stringify(items, null, 2));
}

export function createBroadcast(data: {
  clientId: string;
  name: string;
  message: string;
  connectionId: string;
  delaySeconds: number;
  totalCount: number;
}): Broadcast {
  const items = load();
  const now = new Date().toISOString();
  const broadcast: Broadcast = {
    ...data,
    id: randomUUID(),
    status: "running",
    sentCount: 0,
    failedCount: 0,
    createdAt: now,
    startedAt: now,
  };
  items.push(broadcast);
  save(items);
  return broadcast;
}

export function getBroadcasts(clientId?: string): Broadcast[] {
  const all = load();
  return (clientId ? all.filter((b) => b.clientId === clientId) : all)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function getBroadcastById(id: string): Broadcast | undefined {
  return load().find((b) => b.id === id);
}

export function updateBroadcast(id: string, patch: Partial<Omit<Broadcast, "id">>): Broadcast | null {
  const items = load();
  const idx = items.findIndex((b) => b.id === id);
  if (idx < 0) return null;
  items[idx] = { ...items[idx], ...patch };
  if ((patch.status === "cancelled" || patch.status === "completed") && !items[idx].finishedAt) {
    items[idx].finishedAt = new Date().toISOString();
  }
  save(items);
  return items[idx];
}

/** Incrementa o contador cacheado no pai (chamado a cada item processado
 *  pelo orquestrador) — evita reler o arquivo de itens inteiro a cada poll
 *  da tela. Marca "completed" automaticamente quando sent+failed atinge o
 *  total conhecido desde a criação (campanhas canceladas já têm status
 *  trocado direto por cancelBroadcastItems/updateBroadcast, então nunca
 *  batem esse total e não são reabertas por aqui). */
export function incrementBroadcastCounters(id: string, field: "sentCount" | "failedCount"): void {
  const items = load();
  const idx = items.findIndex((b) => b.id === id);
  if (idx < 0) return;
  items[idx][field] += 1;
  const b = items[idx];
  if (b.status === "running" && b.sentCount + b.failedCount >= b.totalCount) {
    b.status = "completed";
    b.finishedAt = new Date().toISOString();
  }
  save(items);
}
