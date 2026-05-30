import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import path from "path";
import { randomUUID } from "crypto";

export type WppConnectSession = {
  id: string;           // UUID — token usado na URL do webhook
  sessionName: string;  // nome da sessão no servidor WPPConnect
  sessionToken: string; // JWT gerado pelo servidor para autenticar chamadas
  funnelId: string | null;
  clientId: string | null;
  hasAgent: boolean;
};

const DIR  = path.join(process.cwd(), "data");
const FILE = path.join(DIR, "wppconnect-sessions.json");

function load(): WppConnectSession[] {
  try {
    if (!existsSync(FILE)) return [];
    return JSON.parse(readFileSync(FILE, "utf-8"));
  } catch {
    return [];
  }
}

function save(sessions: WppConnectSession[]) {
  if (!existsSync(DIR)) mkdirSync(DIR, { recursive: true });
  writeFileSync(FILE, JSON.stringify(sessions, null, 2));
}

export function getWppSessions(): WppConnectSession[] {
  return load();
}

export function getWppSessionById(id: string): WppConnectSession | undefined {
  return load().find(s => s.id === id);
}

export function getWppSessionByName(sessionName: string): WppConnectSession | undefined {
  return load().find(s => s.sessionName === sessionName);
}

export function createWppSession(sessionName: string, sessionToken: string): WppConnectSession {
  const sessions = load();
  const session: WppConnectSession = {
    id: randomUUID(),
    sessionName,
    sessionToken,
    funnelId: null,
    clientId: null,
    hasAgent: false,
  };
  sessions.push(session);
  save(sessions);
  return session;
}

export function updateWppSession(id: string, patch: Partial<WppConnectSession>): void {
  const sessions = load();
  const idx = sessions.findIndex(s => s.id === id);
  if (idx >= 0) {
    sessions[idx] = { ...sessions[idx], ...patch };
    save(sessions);
  }
}

export function deleteWppSessionRecord(id: string): void {
  const sessions = load().filter(s => s.id !== id);
  save(sessions);
}
