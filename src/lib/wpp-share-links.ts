import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import path from "path";
import { randomUUID } from "crypto";

export type WppShareLink = {
  id: string;            // token usado na URL pública (/conectar/[token])
  wppSessionId: string;  // sessão WPPConnect que esse link conecta
  createdAt: string;
  usedAt?: string;       // setado quando a conexão é concluída — invalida o link
  revoked?: boolean;     // um link novo pra mesma sessão revoga o anterior
};

const FILE = path.join(process.cwd(), "data", "wpp-share-links.json");

function load(): WppShareLink[] {
  try {
    if (!existsSync(FILE)) return [];
    return JSON.parse(readFileSync(FILE, "utf-8")) as WppShareLink[];
  } catch {
    return [];
  }
}

function save(links: WppShareLink[]) {
  const dir = path.dirname(FILE);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(FILE, JSON.stringify(links, null, 2));
}

export function isShareLinkValid(link: WppShareLink | undefined): link is WppShareLink {
  return !!link && !link.revoked && !link.usedAt;
}

/** Cria um link novo pra sessão — revoga qualquer link ativo anterior da MESMA
 *  sessão antes, pra nunca ter mais de um link válido por sessão ao mesmo tempo. */
export function createShareLink(wppSessionId: string): WppShareLink {
  const links = load();
  for (const l of links) {
    if (l.wppSessionId === wppSessionId && isShareLinkValid(l)) l.revoked = true;
  }
  const link: WppShareLink = {
    id: randomUUID(),
    wppSessionId,
    createdAt: new Date().toISOString(),
  };
  links.unshift(link);
  save(links);
  return link;
}

export function getActiveShareLinkForSession(wppSessionId: string): WppShareLink | undefined {
  return load().find((l) => l.wppSessionId === wppSessionId && isShareLinkValid(l));
}

export function getShareLinkByToken(token: string): WppShareLink | undefined {
  return load().find((l) => l.id === token);
}

export function markShareLinkUsed(token: string): void {
  const links = load();
  const idx = links.findIndex((l) => l.id === token);
  if (idx === -1) return;
  links[idx] = { ...links[idx], usedAt: new Date().toISOString() };
  save(links);
}
