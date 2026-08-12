import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, readFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import {
  createDevice,
  getDeviceByToken,
  getDevicesForClient,
  getAllDevices,
  computeDisplayState,
  updateHeartbeat,
  revokeDevice,
  revokeDeviceAsManager,
  STALE_AFTER_MS,
} from "../extension-devices";

let tmpDir: string;
let originalCwd: string;

beforeEach(() => {
  originalCwd = process.cwd();
  tmpDir = mkdtempSync(path.join(tmpdir(), "extension-devices-test-"));
  process.chdir(tmpDir);
});

afterEach(() => {
  process.chdir(originalCwd);
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("createDevice / getDeviceByToken", () => {
  it("devolve um token que resolve o dispositivo criado", () => {
    const { device, token } = createDevice({ clientId: "c1", devicePublicId: "dev-1", consentVersion: "1.0.0" });
    const found = getDeviceByToken(token);
    expect(found?.id).toBe(device.id);
  });

  it("nunca persiste o token em texto puro (só o hash)", () => {
    const { token } = createDevice({ clientId: "c1", devicePublicId: "dev-1", consentVersion: "1.0.0" });
    const raw = readFileSync(path.join(tmpDir, "data", "extension-devices.json"), "utf-8");
    expect(raw.includes(token)).toBe(false);
  });

  it("token aleatório não resolve nenhum dispositivo", () => {
    createDevice({ clientId: "c1", devicePublicId: "dev-1", consentVersion: "1.0.0" });
    expect(getDeviceByToken("whx_nao-existe")).toBeUndefined();
  });
});

describe("getDevicesForClient — isolamento entre organizações", () => {
  it("só retorna dispositivos do clientId pedido", () => {
    createDevice({ clientId: "client-a", devicePublicId: "dev-a", consentVersion: "1.0.0" });
    createDevice({ clientId: "client-b", devicePublicId: "dev-b", consentVersion: "1.0.0" });

    const forA = getDevicesForClient("client-a");
    expect(forA).toHaveLength(1);
    expect(forA[0].devicePublicId).toBe("dev-a");
  });
});

describe("revokeDevice", () => {
  it("revoga um dispositivo da organização certa", () => {
    const { device } = createDevice({ clientId: "client-a", devicePublicId: "dev-a", consentVersion: "1.0.0" });
    const ok = revokeDevice(device.id, "client-a");
    expect(ok).toBe(true);
  });

  it("NÃO revoga dispositivo de outra organização mesmo sabendo o id", () => {
    const { device } = createDevice({ clientId: "client-a", devicePublicId: "dev-a", consentVersion: "1.0.0" });
    const ok = revokeDevice(device.id, "client-b");
    expect(ok).toBe(false);

    const stillActive = getDevicesForClient("client-a")[0];
    expect(stillActive.status).toBe("active");
  });

  it("heartbeat é rejeitado depois de revogado", () => {
    const { device } = createDevice({ clientId: "client-a", devicePublicId: "dev-a", consentVersion: "1.0.0" });
    revokeDevice(device.id, "client-a");
    const result = updateHeartbeat(device.id, "connected");
    expect(result).toBeNull();
  });
});

describe("computeDisplayState — staleness", () => {
  it("mostra o último estado reportado enquanto o heartbeat está fresco", () => {
    const { device } = createDevice({ clientId: "client-a", devicePublicId: "dev-a", consentVersion: "1.0.0" });
    updateHeartbeat(device.id, "connected");
    const updated = getDevicesForClient("client-a")[0];
    expect(computeDisplayState(updated)).toBe("connected");
  });

  it("cai pra 'disconnected' depois de STALE_AFTER_MS sem heartbeat", () => {
    vi.useFakeTimers();
    const { device } = createDevice({ clientId: "client-a", devicePublicId: "dev-a", consentVersion: "1.0.0" });
    updateHeartbeat(device.id, "connected");
    vi.advanceTimersByTime(STALE_AFTER_MS + 1000);
    const updated = getDevicesForClient("client-a")[0];
    const state = computeDisplayState(updated);
    vi.useRealTimers();
    expect(state).toBe("disconnected");
  });

  it("dispositivo revogado sempre mostra 'disconnected'", () => {
    const { device } = createDevice({ clientId: "client-a", devicePublicId: "dev-a", consentVersion: "1.0.0" });
    updateHeartbeat(device.id, "connected");
    revokeDevice(device.id, "client-a");
    const raw = JSON.parse(readFileSync(path.join(tmpDir, "data", "extension-devices.json"), "utf-8"))[0];
    expect(computeDisplayState(raw)).toBe("disconnected");
  });
});

describe("getAllDevices — visão do gestor, sem isolamento por organização", () => {
  it("retorna dispositivos de TODAS as organizações", () => {
    createDevice({ clientId: "client-a", devicePublicId: "dev-a", consentVersion: "1.0.0" });
    createDevice({ clientId: "client-b", devicePublicId: "dev-b", consentVersion: "1.0.0" });
    const all = getAllDevices();
    expect(all.map((d) => d.clientId).sort()).toEqual(["client-a", "client-b"]);
  });
});

describe("revokeDeviceAsManager", () => {
  it("revoga um dispositivo sem precisar saber o clientId dele", () => {
    const { device } = createDevice({ clientId: "client-a", devicePublicId: "dev-a", consentVersion: "1.0.0" });
    const ok = revokeDeviceAsManager(device.id);
    expect(ok).toBe(true);
    expect(getAllDevices()[0].status).toBe("revoked");
  });

  it("retorna false pra um id inexistente", () => {
    expect(revokeDeviceAsManager("nao-existe")).toBe(false);
  });
});

describe("funnelId propagado do createDevice ao registro", () => {
  it("guarda o funnelId quando informado", () => {
    const { device } = createDevice({ clientId: "client-a", devicePublicId: "dev-a", consentVersion: "1.0.0", funnelId: "funil-123" });
    expect(device.funnelId).toBe("funil-123");
  });

  it("fica undefined quando não informado (comportamento anterior preservado)", () => {
    const { device } = createDevice({ clientId: "client-a", devicePublicId: "dev-a", consentVersion: "1.0.0" });
    expect(device.funnelId).toBeUndefined();
  });
});
