import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { KANBAN_DAILY_AI_LIMIT, reserveKanbanAnalysis } from "../kanban-usage";
import type { ChatMessage } from "../conversations";

let directory: string;
let original: string;
beforeEach(async () => { original = process.cwd(); directory = await mkdtemp(path.join(tmpdir(), "kanban-usage-")); process.chdir(directory); });
afterEach(async () => { process.chdir(original); await rm(directory, { recursive: true, force: true }); });

const message = (ts: number, content: string): ChatMessage => ({ role: "user", ts, content });

describe("Kanban AI spending guard", () => {
  it("does not charge the same message twice but still reads a new reply", async () => {
    const now = Date.parse("2026-11-10T14:00:00Z");
    expect(await reserveKanbanAnalysis("client", "lead", message(now, "olá"), now)).toBe(true);
    expect(await reserveKanbanAnalysis("client", "lead", message(now, "olá"), now + 10_000)).toBe(false);
    expect(await reserveKanbanAnalysis("client", "lead", message(now + 20_000, "preço?"), now + 20_000)).toBe(true);
    expect(await reserveKanbanAnalysis("client", "lead", message(now + 6 * 60_000, "pode ser"), now + 6 * 60_000)).toBe(true);
  });

  it("stops all additional AI calls after the per-client daily cap", async () => {
    const now = Date.parse("2026-11-10T14:00:00Z");
    for (let i = 0; i < KANBAN_DAILY_AI_LIMIT; i++) {
      expect(await reserveKanbanAnalysis("client", `lead-${i}`, message(now + i, `mensagem ${i}`), now + i)).toBe(true);
    }
    expect(await reserveKanbanAnalysis("client", "extra", message(now + 50_000, "mensagem extra"), now + 50_000)).toBe(false);
    expect(await reserveKanbanAnalysis("other", "extra", message(now + 50_000, "mensagem extra"), now + 50_000)).toBe(true);
  });
});
