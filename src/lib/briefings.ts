import { readDocument, writeDocument, withDataTransaction } from "./document-store";
import path from "path";
import { randomUUID } from "crypto";

export type BriefingStatus = "pending" | "submitted";

export type Briefing = {
  id: string;            // token UUID — usado na URL pública
  clientId: string;      // gestor que criou
  clientName: string;    // nome do cliente (negócio do gestor)
  notifyPhone?: string;  // legado — notificações agora vão via masterPhone nas configs
  niche?: string;        // nicho pré-selecionado (opcional)
  status: BriefingStatus;
  answers?: Record<string, string>;
  createdAt: string;
  submittedAt?: string;
};

const FILE = path.join(process.cwd(), "data", "briefings.json");

async function load(): Promise<Briefing[]> {
  return (await readDocument<Briefing[]>("briefings.json", []));
}

async function save(briefings: Briefing[]) {
  await writeDocument("briefings.json", briefings);
}

export async function createBriefing(data: Omit<Briefing, "id" | "status" | "createdAt">): Promise<Briefing> {
  return withDataTransaction(async () => {
  const briefings = (await load());
  const briefing: Briefing = {
    ...data,
    id: randomUUID(),
    status: "pending",
    createdAt: new Date().toISOString(),
  };
  briefings.unshift(briefing);
  (await save(briefings));
  return briefing;

  });
}

export async function getBriefingByToken(token: string): Promise<Briefing | undefined> {
  return (await load()).find((b) => b.id === token);
}

export async function listBriefingsByClient(clientId: string): Promise<Briefing[]> {
  return (await load()).filter((b) => b.clientId === clientId);
}

export async function submitBriefing(token: string, answers: Record<string, string>): Promise<Briefing | null> {
  return withDataTransaction(async () => {
  const briefings = (await load());
  const idx = briefings.findIndex((b) => b.id === token);
  if (idx === -1) return null;
  briefings[idx] = {
    ...briefings[idx],
    status: "submitted",
    answers,
    submittedAt: new Date().toISOString(),
  };
  (await save(briefings));
  return briefings[idx];

  });
}
