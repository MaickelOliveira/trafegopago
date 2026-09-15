import { randomUUID } from "crypto";
import { existsSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import type { EventoAgendaPousada } from "./pousada-types";

const FILE = path.join(process.cwd(), "data", "pousada-agenda.json");

function load(): EventoAgendaPousada[] {
  try {
    if (!existsSync(FILE)) return [];
    const data = JSON.parse(readFileSync(FILE, "utf-8"));
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function save(data: EventoAgendaPousada[]) {
  writeFileSync(FILE, JSON.stringify(data, null, 2));
}

function normalize(evento: EventoAgendaPousada): EventoAgendaPousada {
  return {
    ...evento,
    titulo: evento.titulo.trim(),
    data: evento.data.slice(0, 10),
    hora: evento.hora?.slice(0, 5) || undefined,
    observacoes: evento.observacoes?.trim() || undefined,
  };
}

export function getEventosAgenda(clientId: string): EventoAgendaPousada[] {
  return load()
    .filter((evento) => evento.clientId === clientId && !evento.arquivado)
    .map(normalize)
    .sort((a, b) => `${a.data} ${a.hora ?? ""}`.localeCompare(`${b.data} ${b.hora ?? ""}`));
}

export function getEventoAgendaById(id: string): EventoAgendaPousada | undefined {
  const evento = load().find((item) => item.id === id);
  return evento ? normalize(evento) : undefined;
}

export function createEventoAgenda(
  data: Omit<EventoAgendaPousada, "id" | "createdAt" | "updatedAt" | "arquivado">,
): EventoAgendaPousada {
  const all = load();
  const now = new Date().toISOString();
  const evento = normalize({
    ...data,
    id: randomUUID(),
    createdAt: now,
    updatedAt: now,
  });
  all.push(evento);
  save(all);
  return evento;
}

export function updateEventoAgenda(
  id: string,
  patch: Partial<Pick<EventoAgendaPousada, "tipo" | "titulo" | "data" | "hora" | "observacoes">>,
): EventoAgendaPousada | null {
  const all = load();
  const index = all.findIndex((item) => item.id === id);
  if (index < 0) return null;

  const updated = normalize({
    ...all[index],
    ...patch,
    updatedAt: new Date().toISOString(),
  });
  all[index] = updated;
  save(all);
  return updated;
}

// Mantém o histórico no arquivo, seguindo a mesma política das reservas.
export function archiveEventoAgenda(id: string): boolean {
  const all = load();
  const index = all.findIndex((item) => item.id === id);
  if (index < 0) return false;
  all[index] = {
    ...all[index],
    arquivado: true,
    updatedAt: new Date().toISOString(),
  };
  save(all);
  return true;
}
