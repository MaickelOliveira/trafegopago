import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import { randomUUID } from "crypto";

export type ServerWhatsAppSession = {
  id: string;
  clientId: string;
  funnelId: string;
  phone: string;
  name?: string;
  createdAt: string;
  updatedAt: string;
};

function dataDir() {
  return path.join(process.cwd(), "data");
}

function sessionsFile() {
  return path.join(dataDir(), "server-whatsapp-sessions.json");
}

function load(): ServerWhatsAppSession[] {
  try {
    if (!existsSync(sessionsFile())) return [];
    const parsed = JSON.parse(readFileSync(sessionsFile(), "utf-8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function save(sessions: ServerWhatsAppSession[]) {
  if (!existsSync(dataDir())) mkdirSync(dataDir(), { recursive: true });
  writeFileSync(sessionsFile(), JSON.stringify(sessions, null, 2));
}

export function getServerWhatsAppSessions(): ServerWhatsAppSession[] {
  return load();
}

export function getServerWhatsAppSessionById(id: string): ServerWhatsAppSession | undefined {
  return load().find((session) => session.id === id);
}

export function createServerWhatsAppSession(input: {
  clientId: string;
  funnelId: string;
  phone: string;
}): ServerWhatsAppSession {
  const sessions = load();
  const now = new Date().toISOString();
  const session: ServerWhatsAppSession = {
    id: randomUUID(),
    clientId: input.clientId,
    funnelId: input.funnelId,
    phone: input.phone,
    createdAt: now,
    updatedAt: now,
  };
  sessions.push(session);
  save(sessions);
  return session;
}

export function updateServerWhatsAppSession(
  id: string,
  patch: Partial<Omit<ServerWhatsAppSession, "id" | "createdAt">>,
): ServerWhatsAppSession | null {
  const sessions = load();
  const index = sessions.findIndex((session) => session.id === id);
  if (index < 0) return null;
  sessions[index] = {
    ...sessions[index],
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  save(sessions);
  return sessions[index];
}

export function deleteServerWhatsAppSession(id: string): boolean {
  const sessions = load();
  const filtered = sessions.filter((session) => session.id !== id);
  if (filtered.length === sessions.length) return false;
  save(filtered);
  return true;
}
