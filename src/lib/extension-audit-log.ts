import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import path from "path";
import { randomUUID } from "crypto";

export type ExtensionAuditEvent =
  | "pairing_code_created"
  | "claim_succeeded"
  | "claim_failed"
  | "device_revoked"
  | "heartbeat_rejected";

export type ExtensionAuditEntry = {
  id: string;
  event: ExtensionAuditEvent;
  clientId?: string;
  pairingId?: string;
  deviceId?: string;
  ip?: string; // truncado — ver truncateIp()
  createdAt: string;
};

const MAX_ENTRIES = 5000; // evita crescimento ilimitado do arquivo

// Calculado a cada chamada — permite que os testes isolem o arquivo via
// process.chdir() num diretório temporário.
function getFilePath(): string {
  return path.join(process.cwd(), "data", "extension-audit-log.json");
}

function load(): ExtensionAuditEntry[] {
  const FILE = getFilePath();
  try {
    if (!existsSync(FILE)) return [];
    return JSON.parse(readFileSync(FILE, "utf-8")) as ExtensionAuditEntry[];
  } catch {
    return [];
  }
}

function save(entries: ExtensionAuditEntry[]) {
  const FILE = getFilePath();
  const dir = path.dirname(FILE);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(FILE, JSON.stringify(entries, null, 2));
}

/** Trunca o último octeto/grupo (IPv4 ou IPv6) — suficiente pra auditoria de
 *  abuso sem guardar o endereço exato do usuário. */
export function truncateIp(ip: string | null | undefined): string | undefined {
  if (!ip) return undefined;
  if (ip.includes(":")) {
    const parts = ip.split(":");
    return parts.slice(0, Math.max(1, parts.length - 2)).join(":") + "::";
  }
  const parts = ip.split(".");
  if (parts.length !== 4) return undefined;
  return `${parts[0]}.${parts[1]}.${parts[2]}.0`;
}

export function recordAuditEvent(entry: Omit<ExtensionAuditEntry, "id" | "createdAt">): void {
  const entries = load();
  entries.unshift({ ...entry, id: randomUUID(), createdAt: new Date().toISOString() });
  save(entries.slice(0, MAX_ENTRIES));
}
