import { readDocument, writeDocument, withDataTransaction } from "./document-store";
/**
 * Store temporário de cliques em botões de WhatsApp rastreados.
 * Cada clique é salvo quando o lead acessa /api/wa-redirect.
 * Quando o lead manda a 1ª mensagem no WhatsApp, o webhook faz o match
 * pelo clientId + janela de tempo (30 min) e associa os UTMs ao lead.
 */

import path from "path";
import { randomUUID } from "crypto";

export type WaClick = {
  id: string;
  clientId: string;
  utmSource: string | null;
  utmCampaign: string | null;
  utmMedium: string | null;
  utmContent: string | null;
  utmTerm: string | null;
  fbclid: string | null;
  gclid: string | null;
  createdAt: string;
  matchedPhone: string | null; // preenchido após match com a mensagem do lead
};

const DIR  = path.join(process.cwd(), "data");
const FILE = path.join(DIR, "wa-clicks.json");
const TTL_MS = 30 * 60 * 1000; // 30 minutos

async function load(): Promise<WaClick[]> {
  return (await readDocument<WaClick[]>("wa-clicks.json", []));
}

async function save(clicks: WaClick[]) {
  await writeDocument("wa-clicks.json", clicks);
}

/** Registra um novo clique e limpa os antigos (> 30 min) */
export async function recordClick(data: Omit<WaClick, "id" | "createdAt" | "matchedPhone">): Promise<WaClick> {
  return withDataTransaction(async () => {
  const all = (await load());
  const now = Date.now();
  // Remove cliques velhos
  const fresh = all.filter((c) => now - new Date(c.createdAt).getTime() < TTL_MS * 4);
  const click: WaClick = { ...data, id: randomUUID(), createdAt: new Date().toISOString(), matchedPhone: null };
  fresh.push(click);
  (await save(fresh));
  return click;

  });
}

/**
 * Encontra o clique não-matched mais antigo nos últimos 30 min para este clientId.
 * Usa estratégia FIFO: o clique mais antigo é o mais provável para o próximo lead.
 */
export async function matchClick(clientId: string, phone: string): Promise<WaClick | null> {
  return withDataTransaction(async () => {
  const all = (await load());
  const now = Date.now();
  const unmatched = all
    .filter((c) =>
      c.clientId === clientId &&
      !c.matchedPhone &&
      now - new Date(c.createdAt).getTime() < TTL_MS
    )
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

  if (!unmatched.length) return null;

  const matched = unmatched[0];
  const updated = all.map((c) => c.id === matched.id ? { ...c, matchedPhone: phone } : c);
  (await save(updated));
  return matched;

  });
}
