import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import path from "path";
import { randomUUID } from "crypto";

export type EvolutionShareLink = {
  id: string;                 // token usado na URL pública (/conectar-evolution/[token])
  evolutionSessionId: string; // instância Evolution que esse link conecta
  createdAt: string;
  usedAt?: string;            // setado quando a conexão é concluída — invalida o link
  revoked?: boolean;          // um link novo pra mesma sessão revoga o anterior
};

const FILE = path.join(process.cwd(), "data", "evolution-share-links.json");

function load(): EvolutionShareLink[] {
  try {
    if (!existsSync(FILE)) return [];
    return JSON.parse(readFileSync(FILE, "utf-8")) as EvolutionShareLink[];
  } catch {
    return [];
  }
}

function save(links: EvolutionShareLink[]) {
  const dir = path.dirname(FILE);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(FILE, JSON.stringify(links, null, 2));
}

export function isShareLinkValid(link: EvolutionShareLink | undefined): link is EvolutionShareLink {
  return !!link && !link.revoked && !link.usedAt;
}

/** Cria um link novo pra sessão — revoga qualquer link ativo anterior da MESMA
 *  sessão antes, pra nunca ter mais de um link válido por sessão ao mesmo tempo. */
export function createShareLink(evolutionSessionId: string): EvolutionShareLink {
  const links = load();
  for (const l of links) {
    if (l.evolutionSessionId === evolutionSessionId && isShareLinkValid(l)) l.revoked = true;
  }
  const link: EvolutionShareLink = {
    id: randomUUID(),
    evolutionSessionId,
    createdAt: new Date().toISOString(),
  };
  links.unshift(link);
  save(links);
  return link;
}

export function getActiveShareLinkForSession(evolutionSessionId: string): EvolutionShareLink | undefined {
  return load().find((l) => l.evolutionSessionId === evolutionSessionId && isShareLinkValid(l));
}

export function getShareLinkByToken(token: string): EvolutionShareLink | undefined {
  return load().find((l) => l.id === token);
}

export function markShareLinkUsed(token: string): void {
  const links = load();
  const idx = links.findIndex((l) => l.id === token);
  if (idx === -1) return;
  links[idx] = { ...links[idx], usedAt: new Date().toISOString() };
  save(links);
}
