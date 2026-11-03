import { readDocument, writeDocument, withDataTransaction } from "./document-store";
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

async function load(): Promise<ChecklistTask[]> {
  return (await readDocument<ChecklistTask[]>("checklists.json", []));
}

async function save(items: ChecklistTask[]) {
  await writeDocument("checklists.json", items);
}

export async function getChecklistTasks(clientId: string): Promise<ChecklistTask[]> {
  return (await load()).filter((t) => t.clientId === clientId);
}

export async function getAllChecklistTasks(): Promise<ChecklistTask[]> {
  return (await load());
}

export async function getChecklistTaskById(id: string): Promise<ChecklistTask | undefined> {
  return (await load()).find((t) => t.id === id);
}

export async function createChecklistTask(
  data: Omit<ChecklistTask, "id" | "done" | "createdAt" | "doneAt">
): Promise<ChecklistTask> {
  return withDataTransaction(async () => {
  const items = (await load());
  const task: ChecklistTask = {
    ...data,
    id: randomUUID(),
    done: false,
    createdAt: new Date().toISOString(),
  };
  items.push(task);
  (await save(items));
  return task;

  });
}

export async function updateChecklistTask(
  id: string,
  patch: Partial<Omit<ChecklistTask, "id" | "clientId" | "createdAt" | "createdBy">>
): Promise<ChecklistTask | null> {
  return withDataTransaction(async () => {
  const items = (await load());
  const idx = items.findIndex((t) => t.id === id);
  if (idx < 0) return null;
  const next = { ...items[idx], ...patch };
  // Marca/desmarca doneAt junto com done, sem precisar o chamador lembrar disso
  if (patch.done === true && !items[idx].done) next.doneAt = new Date().toISOString();
  if (patch.done === false) next.doneAt = undefined;
  items[idx] = next;
  (await save(items));
  return next;

  });
}

export async function deleteChecklistTask(id: string): Promise<boolean> {
  return withDataTransaction(async () => {
  const items = (await load());
  const filtered = items.filter((t) => t.id !== id);
  if (filtered.length === items.length) return false;
  (await save(filtered));
  return true;

  });
}
