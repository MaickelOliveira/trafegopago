import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
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

function load(): Briefing[] {
  try {
    if (!existsSync(FILE)) return [];
    return JSON.parse(readFileSync(FILE, "utf-8")) as Briefing[];
  } catch {
    return [];
  }
}

function save(briefings: Briefing[]) {
  const dir = path.dirname(FILE);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(FILE, JSON.stringify(briefings, null, 2));
}

export function createBriefing(data: Omit<Briefing, "id" | "status" | "createdAt">): Briefing {
  const briefings = load();
  const briefing: Briefing = {
    ...data,
    id: randomUUID(),
    status: "pending",
    createdAt: new Date().toISOString(),
  };
  briefings.unshift(briefing);
  save(briefings);
  return briefing;
}

export function getBriefingByToken(token: string): Briefing | undefined {
  return load().find((b) => b.id === token);
}

export function listBriefingsByClient(clientId: string): Briefing[] {
  return load().filter((b) => b.clientId === clientId);
}

export function submitBriefing(token: string, answers: Record<string, string>): Briefing | null {
  const briefings = load();
  const idx = briefings.findIndex((b) => b.id === token);
  if (idx === -1) return null;
  briefings[idx] = {
    ...briefings[idx],
    status: "submitted",
    answers,
    submittedAt: new Date().toISOString(),
  };
  save(briefings);
  return briefings[idx];
}
