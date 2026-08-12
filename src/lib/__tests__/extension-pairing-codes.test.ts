import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { createPairingCode, claimPairingCode, normalizeCode } from "../extension-pairing-codes";

// Isola cada teste num diretório temporário — os módulos calculam o caminho
// do arquivo por chamada (getFilePath()), então bastar trocar o cwd antes de
// cada teste já isola completamente sem precisar mockar fs.
let tmpDir: string;
let originalCwd: string;

beforeEach(() => {
  originalCwd = process.cwd();
  tmpDir = mkdtempSync(path.join(tmpdir(), "pairing-codes-test-"));
  process.chdir(tmpDir);
});

afterEach(() => {
  process.chdir(originalCwd);
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("createPairingCode", () => {
  it("gera um código formatado em 3 grupos de 4 caracteres", () => {
    const { code } = createPairingCode("client-1");
    expect(code).toMatch(/^[23456789A-HJ-NP-TV-Z]{4}-[23456789A-HJ-NP-TV-Z]{4}-[23456789A-HJ-NP-TV-Z]{4}$/);
  });

  it("expira em ~10 minutos", () => {
    const before = Date.now();
    const { expiresAt } = createPairingCode("client-1");
    const diff = new Date(expiresAt).getTime() - before;
    expect(diff).toBeGreaterThan(9 * 60 * 1000);
    expect(diff).toBeLessThanOrEqual(10 * 60 * 1000 + 1000);
  });

  it("invalida o código anterior do MESMO cliente ao gerar um novo", () => {
    const first = createPairingCode("client-1");
    createPairingCode("client-1");

    const result = claimPairingCode(first.code);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("expired");
  });

  it("não invalida o código de OUTRO cliente", () => {
    const a = createPairingCode("client-a");
    createPairingCode("client-b");

    const result = claimPairingCode(a.code);
    expect(result.ok).toBe(true);
  });
});

describe("claimPairingCode", () => {
  it("aceita o código correto uma vez", () => {
    const { code } = createPairingCode("client-1");
    const result = claimPairingCode(code);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.pairing.clientId).toBe("client-1");
  });

  it("rejeita reutilização do mesmo código (uso único)", () => {
    const { code } = createPairingCode("client-1");
    claimPairingCode(code);
    const second = claimPairingCode(code);
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.reason).toBe("used");
  });

  it("rejeita código inexistente", () => {
    const result = claimPairingCode("ZZZZ-ZZZZ-ZZZZ");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("not_found");
  });

  it("rejeita código expirado", () => {
    vi.useFakeTimers();
    const { code } = createPairingCode("client-1");
    vi.advanceTimersByTime(11 * 60 * 1000);
    const result = claimPairingCode(code);
    vi.useRealTimers();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("expired");
  });

  it("aceita o código colado com espaços/traços/minúsculas diferentes", () => {
    const { code } = createPairingCode("client-1");
    const messy = "  " + code.toLowerCase().replace(/-/g, " ") + "  ";
    const result = claimPairingCode(messy);
    expect(result.ok).toBe(true);
  });
});

describe("normalizeCode", () => {
  it("remove espaços e traços, deixa maiúsculo", () => {
    expect(normalizeCode(" ab3d-ef7h ")).toBe("AB3DEF7H");
  });
});

describe("funnelId propagado do createPairingCode ao claim", () => {
  it("o pairing resultante do claim carrega o funnelId informado na criação", () => {
    const { code } = createPairingCode("client-1", { funnelId: "funil-abc" });
    const result = claimPairingCode(code);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.pairing.funnelId).toBe("funil-abc");
  });

  it("fica undefined quando não informado (comportamento anterior preservado)", () => {
    const { code } = createPairingCode("client-1");
    const result = claimPairingCode(code);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.pairing.funnelId).toBeUndefined();
  });
});
