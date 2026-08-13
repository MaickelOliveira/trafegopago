import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { queueReply, getPendingReplies, markDelivered, markFailed } from "../extension-outbox";

let tmpDir: string;
let originalCwd: string;

beforeEach(() => {
  originalCwd = process.cwd();
  tmpDir = mkdtempSync(path.join(tmpdir(), "extension-outbox-test-"));
  process.chdir(tmpDir);
});

afterEach(() => {
  process.chdir(originalCwd);
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("queueReply / getPendingReplies", () => {
  it("uma resposta enfileirada aparece nas pendências do mesmo device", () => {
    queueReply("device-1", "5511999998888@c.us", "5511999998888", "Oi!");
    const pending = getPendingReplies("device-1");
    expect(pending).toHaveLength(1);
    expect(pending[0].chatId).toBe("5511999998888@c.us");
    expect(pending[0].text).toBe("Oi!");
  });

  it("não vaza pendência de um device pro outro", () => {
    queueReply("device-a", "111@c.us", "111", "pra A");
    queueReply("device-b", "222@c.us", "222", "pra B");
    expect(getPendingReplies("device-a")).toHaveLength(1);
    expect(getPendingReplies("device-b")).toHaveLength(1);
    expect(getPendingReplies("device-a")[0].text).toBe("pra A");
  });
});

describe("markDelivered", () => {
  it("some da lista de pendências depois de marcada como entregue", () => {
    const reply = queueReply("device-1", "111@c.us", "111", "oi");
    markDelivered(reply.id);
    expect(getPendingReplies("device-1")).toHaveLength(0);
  });

  it("id inexistente devolve null", () => {
    expect(markDelivered("nao-existe")).toBeNull();
  });
});

describe("markFailed", () => {
  it("some da lista de pendências e registra o erro depois de marcada como falha", () => {
    const reply = queueReply("device-1", "111@c.us", "111", "oi");
    const updated = markFailed(reply.id, "timeout");
    expect(getPendingReplies("device-1")).toHaveLength(0);
    expect(updated?.error).toBe("timeout");
  });
});
