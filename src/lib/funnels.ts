import { readFileSync, writeFileSync, existsSync } from "fs";
import path from "path";
import { randomUUID } from "crypto";

export type TriggerPhrase = {
  text: string;
  match: "exact" | "contains";
};

export type FunnelColumn = {
  id: string;
  label: string;
  color: string;
  metaEvent?: string;           // evento CAPI disparado quando lead entra nesta coluna
  blockAutoMove?: boolean;      // bloqueia movimentação automática pelo agente IA
  askValueOnMove?: boolean;     // abre modal pedindo valor + data quando lead entra aqui
  triggerPhrases?: TriggerPhrase[];  // frases que movem o lead para esta coluna
  aiDescription?: string;       // contexto para o agente IA: quando mover o lead para esta coluna
  allowedTransitions?: string[]; // camada 3: whitelist de IDs de colunas de destino permitidas (vazio = todas)
};

export type ConnectionType = "meta" | "uazapi";

export type FunnelConnection = {
  id: string;
  phone: string;
  type: ConnectionType;
  // Meta Cloud API
  metaPhoneNumberId?: string;
  metaToken?: string;
  metaVerifyToken?: string;
  // UazAPI
  uazapiToken?: string;
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

// Normaliza dados antigos: triggerPhrases pode ser string[] ou TriggerPhrase[]
function normalizeFunnels(funnels: Funnel[]): Funnel[] {
  return funnels.map((f) => ({
    ...f,
    columns: f.columns.map((c) => ({
      ...c,
      triggerPhrases: (c.triggerPhrases as unknown as (string | TriggerPhrase)[])?.map((p) =>
        typeof p === "string" ? { text: p, match: "contains" as const } : p
      ),
    })),
  }));
}

function load(): Funnel[] {
  try {
    if (!existsSync(FILE)) return [];
    return normalizeFunnels(JSON.parse(readFileSync(FILE, "utf-8")));
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
