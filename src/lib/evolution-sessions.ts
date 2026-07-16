import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import path from "path";
import { randomUUID } from "crypto";

export type EvolutionSession = {
  id: string;              // UUID — token usado na URL do webhook
  instanceName: string;    // nome da instância no servidor Evolution
  instanceApiKey: string;  // apikey retornada na criação (ou "" se o servidor só usa a admin key)
  funnelId: string | null;
  clientId: string | null;
  hasAgent: boolean;
};

const DIR  = path.join(process.cwd(), "data");
const FILE = path.join(DIR, "evolution-sessions.json");

function load(): EvolutionSession[] {
  try {
    if (!existsSync(FILE)) return [];
    return JSON.parse(readFileSync(FILE, "utf-8"));
  } catch {
    return [];
  }
}

function save(sessions: EvolutionSession[]) {
  if (!existsSync(DIR)) mkdirSync(DIR, { recursive: true });
  writeFileSync(FILE, JSON.stringify(sessions, null, 2));
}

export function getEvolutionSessions(): EvolutionSession[] {
  return load();
}

export function getEvolutionSessionById(id: string): EvolutionSession | undefined {
  return load().find(s => s.id === id);
}

export function getEvolutionSessionByName(instanceName: string): EvolutionSession | undefined {
  return load().find(s => s.instanceName === instanceName);
}

export function createEvolutionSession(instanceName: string, instanceApiKey: string): EvolutionSession {
  const sessions = load();
  const session: EvolutionSession = {
    id: randomUUID(),
    instanceName,
    instanceApiKey,
    funnelId: null,
    clientId: null,
    hasAgent: false,
  };
  sessions.push(session);
  save(sessions);
  return session;
}

export function updateEvolutionSession(id: string, patch: Partial<EvolutionSession>): void {
  const sessions = load();
  const idx = sessions.findIndex(s => s.id === id);
  if (idx >= 0) {
    sessions[idx] = { ...sessions[idx], ...patch };
    save(sessions);
  }
}

export function deleteEvolutionSessionRecord(id: string): void {
  const sessions = load().filter(s => s.id !== id);
  save(sessions);
}
