import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { readDocument, writeDocument } from "../document-store";
import { syncLeadAiPause } from "../lead-context";

const phone = "5511999990000";
let directory: string;
let originalCwd: string;

beforeEach(async () => {
  originalCwd = process.cwd();
  directory = await mkdtemp(path.join(tmpdir(), "nexo-ai-pause-"));
  process.chdir(directory);
  await writeDocument("funnels.json", [
    { id: "main", clientId: "example-client", name: "Main", columns: [], connections: [{ id: "meta-main", phone, type: "meta" }] },
    { id: "other-funnel", clientId: "example-client", name: "Other", columns: [] },
  ]);
  await writeDocument("evolution-sessions.json", [
    { id: "evo-main", clientId: "example-client", funnelId: "main", instanceName: "example-main", instanceApiKey: "", hasAgent: true },
    { id: "evo-other", clientId: "example-client", funnelId: "other-funnel", instanceName: "example-other", instanceApiKey: "", hasAgent: false },
    { id: "foreign", clientId: "other-client", funnelId: "main", instanceName: "foreign", instanceApiKey: "", hasAgent: true },
  ]);
  await writeDocument("conversations.json", Object.fromEntries(
    ["evo-main", "meta-main", "evo-other", "foreign"].map(connId => [
      `example-client:${connId}:${phone}`,
      { clientId: "example-client", connId, messages: [], lastActivity: 1, aiPaused: true },
    ]),
  ));
});

afterEach(async () => {
  process.chdir(originalCwd);
  await rm(directory, { recursive: true, force: true });
});

describe("CRM AI pause synchronization", () => {
  it("resumes only conversations connected to the lead's funnel", async () => {
    await syncLeadAiPause({ clientId: "example-client", funnelId: "main", phone }, false);
    const conversations = await readDocument<Record<string, { aiPaused: boolean }>>("conversations.json", {});
    expect(conversations[`example-client:evo-main:${phone}`].aiPaused).toBe(false);
    expect(conversations[`example-client:meta-main:${phone}`].aiPaused).toBe(false);
    expect(conversations[`example-client:evo-other:${phone}`].aiPaused).toBe(true);
    expect(conversations[`example-client:foreign:${phone}`].aiPaused).toBe(true);
  });
});
