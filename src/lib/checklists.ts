import { readFileSync, writeFileSync, existsSync } from "fs";
import path from "path";
import { randomUUID } from "crypto";

export type ChecklistOwner = "gestor" | "cliente";

export type ChecklistTask = {
  id: string;
  clientId: string;
  title: string;
  dueDate?: string;       // ISO date — opcional, nem toda tarefa tem prazo
  owner: ChecklistOwner;  // de quem é a responsabilidade
  done: boolean;
  doneAt?: string;
  createdBy: "manager" | "client";
  createdAt: string;
};

const FILE = path.join(process.cwd(), "data", "checklists.json");

function load(): ChecklistTask[] {
  try {
    if (!existsSync(FILE)) return [];
    return JSON.parse(readFileSync(FILE, "utf-8"));
  } catch {
    return [];
  }
}

function save(items: ChecklistTask[]) {
  writeFileSync(FILE, JSON.stringify(items, null, 2));
}

export function getChecklistTasks(clientId: string): ChecklistTask[] {
  return load().filter((t) => t.clientId === clientId);
}

export function getAllChecklistTasks(): ChecklistTask[] {
  return load();
}

export function getChecklistTaskById(id: string): ChecklistTask | undefined {
  return load().find((t) => t.id === id);
}

export function createChecklistTask(
  data: Omit<ChecklistTask, "id" | "done" | "createdAt" | "doneAt">
): ChecklistTask {
  const items = load();
  const task: ChecklistTask = {
    ...data,
    id: randomUUID(),
    done: false,
    createdAt: new Date().toISOString(),
  };
  items.push(task);
  save(items);
  return task;
}

export function updateChecklistTask(
  id: string,
  patch: Partial<Omit<ChecklistTask, "id" | "clientId" | "createdAt" | "createdBy">>
): ChecklistTask | null {
  const items = load();
  const idx = items.findIndex((t) => t.id === id);
  if (idx < 0) return null;
  const next = { ...items[idx], ...patch };
  // Marca/desmarca doneAt junto com done, sem precisar o chamador lembrar disso
  if (patch.done === true && !items[idx].done) next.doneAt = new Date().toISOString();
  if (patch.done === false) next.doneAt = undefined;
  items[idx] = next;
  save(items);
  return next;
}

export function deleteChecklistTask(id: string): boolean {
  const items = load();
  const filtered = items.filter((t) => t.id !== id);
  if (filtered.length === items.length) return false;
  save(filtered);
  return true;
}
