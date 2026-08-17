import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import {
  createServerWhatsAppSession,
  deleteServerWhatsAppSession,
  getServerWhatsAppSessionById,
  getServerWhatsAppSessions,
  updateServerWhatsAppSession,
} from "../server-whatsapp-sessions";

let temporaryDirectory: string;
let originalWorkingDirectory: string;

beforeEach(() => {
  originalWorkingDirectory = process.cwd();
  temporaryDirectory = mkdtempSync(path.join(tmpdir(), "server-wa-sessions-test-"));
  process.chdir(temporaryDirectory);
});

afterEach(() => {
  process.chdir(originalWorkingDirectory);
  rmSync(temporaryDirectory, { recursive: true, force: true });
});

describe("server WhatsApp sessions", () => {
  it("persiste cliente, funil e telefone", () => {
    const created = createServerWhatsAppSession({
      clientId: "client-1",
      funnelId: "funnel-1",
      phone: "5511999999999",
    });

    expect(getServerWhatsAppSessionById(created.id)).toMatchObject({
      clientId: "client-1",
      funnelId: "funnel-1",
      phone: "5511999999999",
    });
  });

  it("atualiza os dados conhecidos depois da conexão", () => {
    const created = createServerWhatsAppSession({
      clientId: "client-1",
      funnelId: "funnel-1",
      phone: "5511000000000",
    });

    updateServerWhatsAppSession(created.id, { phone: "5511999999999", name: "Comercial" });
    expect(getServerWhatsAppSessionById(created.id)).toMatchObject({
      phone: "5511999999999",
      name: "Comercial",
    });
  });

  it("remove somente a sessão escolhida", () => {
    const first = createServerWhatsAppSession({ clientId: "c1", funnelId: "f1", phone: "5511111111111" });
    createServerWhatsAppSession({ clientId: "c2", funnelId: "f2", phone: "5522222222222" });

    expect(deleteServerWhatsAppSession(first.id)).toBe(true);
    expect(getServerWhatsAppSessions()).toHaveLength(1);
    expect(getServerWhatsAppSessions()[0].clientId).toBe("c2");
  });
});

