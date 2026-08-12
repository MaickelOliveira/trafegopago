import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import path from "path";
import { randomUUID, randomBytes, createHash } from "crypto";

export type PairingCode = {
  id: string;             // uuid interno — nunca exposto ao cliente
  clientId: string;
  employeeId?: string;
  funnelId?: string;      // funil onde os leads dessa conexão vão cair (ver upsertLeadByPhone)
  codeHash: string;       // sha256 do código puro — o código em si nunca é persistido
  expiresAt: string;
  usedAt?: string;
  createdIp?: string;
  createdAt: string;
};

const TTL_MS = 10 * 60 * 1000; // 10 minutos
// Crockford base32 sem caracteres ambíguos (0/O, 1/I/L) — código digitável à mão.
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTVWXYZ";

// Calculado a cada chamada (não como constante de módulo) — permite que os
// testes isolem o arquivo via process.chdir() num diretório temporário sem
// depender da ordem de import dos módulos.
function getFilePath(): string {
  return path.join(process.cwd(), "data", "extension-pairing-codes.json");
}

function load(): PairingCode[] {
  const FILE = getFilePath();
  try {
    if (!existsSync(FILE)) return [];
    return JSON.parse(readFileSync(FILE, "utf-8")) as PairingCode[];
  } catch {
    return [];
  }
}

function save(codes: PairingCode[]) {
  const FILE = getFilePath();
  const dir = path.dirname(FILE);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(FILE, JSON.stringify(codes, null, 2));
}

function hashCode(rawCode: string): string {
  return createHash("sha256").update(rawCode).digest("hex");
}

/** Gera um código amigável de 12 caracteres (128 bits de entropia — 5 bits/char
 *  × ~26 chars úteis, arredondado para cima), formatado em grupos de 4 pra
 *  facilitar digitação manual na extensão (ex: "XV3K-9BQP-2MRT"). */
function generateFriendlyCode(): string {
  const bytes = randomBytes(16); // 128 bits
  let bits = "";
  for (const b of bytes) bits += b.toString(2).padStart(8, "0");
  let out = "";
  for (let i = 0; i + 5 <= bits.length; i += 5) {
    out += ALPHABET[parseInt(bits.slice(i, i + 5), 2) % ALPHABET.length];
  }
  const chars = out.slice(0, 12).split("");
  return [chars.slice(0, 4).join(""), chars.slice(4, 8).join(""), chars.slice(8, 12).join("")].join("-");
}

/** Normaliza a entrada do usuário (maiúsculas, remove espaços/traços) antes de
 *  hashear — a extensão deve aceitar colar o código com ou sem os separadores. */
export function normalizeCode(input: string): string {
  return input.trim().toUpperCase().replace(/[\s-]/g, "");
}

export function createPairingCode(
  clientId: string,
  opts?: { employeeId?: string; createdIp?: string; funnelId?: string }
): { code: string; expiresAt: string } {
  const codes = load();
  // Um código novo invalida qualquer código pendente da MESMA organização —
  // nunca mais de um código ativo por cliente ao mesmo tempo.
  for (const c of codes) {
    if (c.clientId === clientId && !c.usedAt && new Date(c.expiresAt).getTime() > Date.now()) {
      c.expiresAt = new Date(0).toISOString();
    }
  }

  const rawCode = generateFriendlyCode();
  const expiresAt = new Date(Date.now() + TTL_MS).toISOString();
  const entry: PairingCode = {
    id: randomUUID(),
    clientId,
    employeeId: opts?.employeeId,
    funnelId: opts?.funnelId,
    codeHash: hashCode(normalizeCode(rawCode)),
    expiresAt,
    createdIp: opts?.createdIp,
    createdAt: new Date().toISOString(),
  };
  codes.unshift(entry);
  save(codes);
  return { code: rawCode, expiresAt };
}

export type ClaimResult =
  | { ok: true; pairing: PairingCode }
  | { ok: false; reason: "not_found" | "expired" | "used" };

/** Valida e consome um código — uso único. Proteção contra força bruta de
 *  adivinhar um código válido é feita por rate-limit de IP no endpoint
 *  (não faz sentido um contador de tentativas por código aqui: um hash que
 *  não bate com nenhum registro não tem como ser atribuído a um código
 *  pendente específico). */
export function claimPairingCode(rawCode: string): ClaimResult {
  const codes = load();
  const normalized = normalizeCode(rawCode);
  const hash = hashCode(normalized);
  const idx = codes.findIndex((c) => c.codeHash === hash);

  if (idx === -1) return { ok: false, reason: "not_found" };
  const entry = codes[idx];

  if (entry.usedAt) return { ok: false, reason: "used" };
  if (new Date(entry.expiresAt).getTime() < Date.now()) return { ok: false, reason: "expired" };

  entry.usedAt = new Date().toISOString();
  codes[idx] = entry;
  save(codes);
  return { ok: true, pairing: entry };
}
