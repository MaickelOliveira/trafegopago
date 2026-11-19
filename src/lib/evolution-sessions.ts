import { readDocument, writeDocument, withDataTransaction } from "./document-store";
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

async function load(): Promise<EvolutionSession[]> {
  return (await readDocument<EvolutionSession[]>("evolution-sessions.json", []));
}

async function save(sessions: EvolutionSession[]) {
  await writeDocument("evolution-sessions.json", sessions);
}

export async function getEvolutionSessions(): Promise<EvolutionSession[]> {
  return (await load());
}

export async function getEvolutionSessionById(id: string): Promise<EvolutionSession | undefined> {
  return (await load()).find(s => s.id === id);
}

export async function getEvolutionSessionByName(instanceName: string): Promise<EvolutionSession | undefined> {
  return (await load()).find(s => s.instanceName === instanceName);
}

export async function createEvolutionSession(instanceName: string, instanceApiKey: string): Promise<EvolutionSession> {
  return withDataTransaction(async () => {
  const sessions = (await load());
  const session: EvolutionSession = {
    id: randomUUID(),
    instanceName,
    instanceApiKey,
    funnelId: null,
    clientId: null,
    hasAgent: false,
  };
  sessions.push(session);
  (await save(sessions));
  return session;

  });
}

export async function updateEvolutionSession(id: string, patch: Partial<EvolutionSession>): Promise<void> {
  return withDataTransaction(async () => {
  const sessions = (await load());
  const idx = sessions.findIndex(s => s.id === id);
  if (idx >= 0) {
    sessions[idx] = { ...sessions[idx], ...patch };
    (await save(sessions));
  }

  });
}

export async function deleteEvolutionSessionRecord(id: string): Promise<void> {
  return withDataTransaction(async () => {
  const sessions = (await load()).filter(s => s.id !== id);
  (await save(sessions));

  });
}
