import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import path from "path";
import { randomUUID, randomBytes, createHash } from "crypto";
import type { ExtensionConnectorState } from "./extension-types";

export type { ExtensionConnectorState };
export type DeviceStatus = "active" | "revoked";

export type ExtensionDevice = {
  id: string;
  clientId: string;
  employeeId?: string;
  funnelId?: string;            // funil onde os leads dessa conexão caem (mesmo papel de EvolutionSession.funnelId)
  devicePublicId: string;       // identificador não-secreto do navegador/instalação (exibição/auditoria)
  tokenHash: string;            // sha256 da credencial do dispositivo — a credencial em si nunca é persistida
  status: DeviceStatus;
  connectorState: ExtensionConnectorState; // último estado reportado pelo content script via heartbeat
  lastSeenAt: string;
  consentVersion: string;
  consentAt: string;
  revokedAt?: string;
  createdAt: string;
  updatedAt: string;
};

// Sem heartbeat por esse tempo, o dispositivo é considerado desconectado na
// tela do gestor/cliente — não há como detectar fechamento de aba de forma
// confiável a partir de um service worker MV3, então o status "desconectado"
// é sempre inferido por ausência de heartbeat recente, não por um evento
// explícito de "aba fechada". A extensão manda heartbeat a cada 1 min (limite
// mínimo do chrome.alarms pra extensões publicadas — ver extension/src/config.ts);
// 150s dá folga pra 1 heartbeat perdido sem marcar "desconectado" à toa.
export const STALE_AFTER_MS = 150_000;

// Calculado a cada chamada — permite que os testes isolem o arquivo via
// process.chdir() num diretório temporário.
function getFilePath(): string {
  return path.join(process.cwd(), "data", "extension-devices.json");
}

function load(): ExtensionDevice[] {
  const FILE = getFilePath();
  try {
    if (!existsSync(FILE)) return [];
    return JSON.parse(readFileSync(FILE, "utf-8")) as ExtensionDevice[];
  } catch {
    return [];
  }
}

function save(devices: ExtensionDevice[]) {
  const FILE = getFilePath();
  const dir = path.dirname(FILE);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(FILE, JSON.stringify(devices, null, 2));
}

function hashToken(rawToken: string): string {
  return createHash("sha256").update(rawToken).digest("hex");
}

export function generateDeviceToken(): string {
  return `whx_${randomBytes(32).toString("hex")}`;
}

export function createDevice(data: {
  clientId: string;
  employeeId?: string;
  devicePublicId: string;
  consentVersion: string;
}): { device: ExtensionDevice; token: string } {
  const devices = load();
  const token = generateDeviceToken();
  const now = new Date().toISOString();
  const device: ExtensionDevice = {
    id: randomUUID(),
    clientId: data.clientId,
    employeeId: data.employeeId,
    // funnelId começa vazio — o gestor vincula o CRM depois pelo botão
    // "🔀 Vincular CRM" (mesmo fluxo da Evolution/UazAPI/WPPConnect), não o
    // próprio cliente no momento de gerar o código de pareamento.
    devicePublicId: data.devicePublicId,
    tokenHash: hashToken(token),
    status: "active",
    connectorState: "waiting_qr",
    lastSeenAt: now,
    consentVersion: data.consentVersion,
    consentAt: now,
    createdAt: now,
    updatedAt: now,
  };
  devices.unshift(device);
  save(devices);
  return { device, token };
}

export function getDeviceByToken(rawToken: string): ExtensionDevice | undefined {
  const hash = hashToken(rawToken);
  return load().find((d) => d.tokenHash === hash);
}

export function getDevicesForClient(clientId: string): ExtensionDevice[] {
  return load().filter((d) => d.clientId === clientId);
}

/** Sem filtro de organização — só pra visão do gestor (mesmo padrão de
 *  getClients() sem filtro usado em evolution-manager/route.ts). Nunca expor
 *  isso num endpoint que não confira session.role === "manager" antes. */
export function getAllDevices(): ExtensionDevice[] {
  return load();
}

/** Status exibido pra UI — deriva "disconnected" por staleness mesmo que o
 *  último `connectorState` reportado tenha sido "connected", sem precisar de
 *  um evento explícito de fechamento de aba (ver STALE_AFTER_MS). */
export function computeDisplayState(device: ExtensionDevice): ExtensionConnectorState {
  if (device.status === "revoked") return "disconnected";
  const staleMs = Date.now() - new Date(device.lastSeenAt).getTime();
  if (staleMs > STALE_AFTER_MS) return "disconnected";
  return device.connectorState;
}

export function updateHeartbeat(
  deviceId: string,
  connectorState: ExtensionConnectorState
): ExtensionDevice | null {
  const devices = load();
  const idx = devices.findIndex((d) => d.id === deviceId);
  if (idx === -1) return null;
  if (devices[idx].status === "revoked") return null;
  devices[idx] = {
    ...devices[idx],
    connectorState,
    lastSeenAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  save(devices);
  return devices[idx];
}

export function revokeDevice(deviceId: string, clientId: string): boolean {
  const devices = load();
  const idx = devices.findIndex((d) => d.id === deviceId && d.clientId === clientId);
  if (idx === -1) return false;
  const now = new Date().toISOString();
  devices[idx] = { ...devices[idx], status: "revoked", revokedAt: now, updatedAt: now };
  save(devices);
  return true;
}

/** Mesma coisa que revokeDevice, sem exigir clientId — só pra chamada do
 *  gestor, que já tem acesso irrestrito a todas as organizações em todas as
 *  outras telas administrativas do projeto (ex: evolution-manager). */
export function revokeDeviceAsManager(deviceId: string): boolean {
  const devices = load();
  const idx = devices.findIndex((d) => d.id === deviceId);
  if (idx === -1) return false;
  const now = new Date().toISOString();
  devices[idx] = { ...devices[idx], status: "revoked", revokedAt: now, updatedAt: now };
  save(devices);
  return true;
}

/** Vincula (ou desvincula, com funnelId=null) o funil de CRM de um
 *  dispositivo — chamada só pelo gestor, mesmo papel de updateEvolutionSession
 *  pra funnelId. Sem exigir clientId pela mesma razão de revokeDeviceAsManager. */
export function updateDeviceFunnel(deviceId: string, funnelId: string | null): boolean {
  const devices = load();
  const idx = devices.findIndex((d) => d.id === deviceId);
  if (idx === -1) return false;
  const updated = { ...devices[idx], updatedAt: new Date().toISOString() };
  if (funnelId) updated.funnelId = funnelId;
  else delete updated.funnelId;
  devices[idx] = updated;
  save(devices);
  return true;
}
