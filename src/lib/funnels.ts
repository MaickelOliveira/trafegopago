import { readFileSync, writeFileSync, existsSync } from "fs";
import path from "path";
import { randomUUID } from "crypto";

export type FunnelColumn = {
  id: string;
  label: string;
  color: string;
  metaEvent?: string; // evento da CAPI disparado quando lead entra nesta coluna
};

export type ConnectionType = "baileys" | "meta";

export type FunnelConnection = {
  id: string;
  phone: string;
  type: ConnectionType;
  // Meta Cloud API
  metaPhoneNumberId?: string;
  metaToken?: string;
  metaVerifyToken?: string;
};

export type Funnel = {
  id: string;
  name: string;
  columns: FunnelColumn[];
  clientId?: string | null;
  whatsappPhone?: string | null; // legado
  connections?: FunnelConnection[];
};

const FILE = path.join(process.cwd(), "data", "funnels.json");

function load(): Funnel[] {
  try {
    if (!existsSync(FILE)) return [];
    return JSON.parse(readFileSync(FILE, "utf-8"));
  } catch {
    return [];
  }
}

function save(funnels: Funnel[]) {
  writeFileSync(FILE, JSON.stringify(funnels, null, 2));
}

export function getFunnels(): Funnel[] { return load(); }

export function getFunnelById(id: string): Funnel | undefined {
  return load().find((f) => f.id === id);
}

export function createFunnel(name: string, columns?: FunnelColumn[]): Funnel {
  const funnels = load();
  const funnel: Funnel = {
    id: randomUUID(),
    name,
    columns: columns ?? [
      { id: "entrada",  label: "Entrada de Contatos", color: "#6366F1" },
      { id: "novo",     label: "Novo",       color: "#3B82F6" },
      { id: "contato",  label: "Em Contato", color: "#F59E0B" },
      { id: "proposta", label: "Proposta",   color: "#F97316" },
      { id: "ganho",    label: "Ganho",      color: "#10B981" },
      { id: "perdido",  label: "Perdido",    color: "#94A3B8" },
    ],
  };
  funnels.push(funnel);
  save(funnels);
  return funnel;
}

export function updateFunnel(id: string, patch: Partial<Omit<Funnel, "id">>): Funnel | null {
  const funnels = load();
  const idx = funnels.findIndex((f) => f.id === id);
  if (idx < 0) return null;
  funnels[idx] = { ...funnels[idx], ...patch };
  save(funnels);
  return funnels[idx];
}

export function deleteFunnel(id: string): boolean {
  if (id === "default") return false; // funil padrão não pode ser deletado
  const funnels = load();
  const filtered = funnels.filter((f) => f.id !== id);
  if (filtered.length === funnels.length) return false;
  save(filtered);
  return true;
}
