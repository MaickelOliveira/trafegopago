import { readDocument, writeDocument, withDataTransaction } from "./document-store";
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

async function load(): Promise<EvolutionShareLink[]> {
  return (await readDocument<EvolutionShareLink[]>("evolution-share-links.json", []));
}

async function save(links: EvolutionShareLink[]) {
  await writeDocument("evolution-share-links.json", links);
}

export function isShareLinkValid(link: EvolutionShareLink | undefined): link is EvolutionShareLink {
  return !!link && !link.revoked && !link.usedAt;
}

/** Cria um link novo pra sessão — revoga qualquer link ativo anterior da MESMA
 *  sessão antes, pra nunca ter mais de um link válido por sessão ao mesmo tempo. */
export async function createShareLink(evolutionSessionId: string): Promise<EvolutionShareLink> {
  return withDataTransaction(async () => {
  const links = (await load());
  for (const l of links) {
    if (l.evolutionSessionId === evolutionSessionId && isShareLinkValid(l)) l.revoked = true;
  }
  const link: EvolutionShareLink = {
    id: randomUUID(),
    evolutionSessionId,
    createdAt: new Date().toISOString(),
  };
  links.unshift(link);
  (await save(links));
  return link;

  });
}

export async function getActiveShareLinkForSession(evolutionSessionId: string): Promise<EvolutionShareLink | undefined> {
  return (await load()).find((l) => l.evolutionSessionId === evolutionSessionId && isShareLinkValid(l));
}

export async function getShareLinkByToken(token: string): Promise<EvolutionShareLink | undefined> {
  return (await load()).find((l) => l.id === token);
}

export async function markShareLinkUsed(token: string): Promise<void> {
  return withDataTransaction(async () => {
  const links = (await load());
  const idx = links.findIndex((l) => l.id === token);
  if (idx === -1) return;
  links[idx] = { ...links[idx], usedAt: new Date().toISOString() };
  (await save(links));

  });
}
