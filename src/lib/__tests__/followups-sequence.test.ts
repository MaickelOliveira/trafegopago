import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
vi.mock("../lead-context", () => ({ getLeadForConnection: vi.fn(async (_client, _phone, conn) => ({ id: `lead-${conn}`, clientId: "a", funnelId: `f-${conn}`, phone: "44999999999", status: "novo" })) }));
vi.mock("../clients", () => ({ getClientById: vi.fn(async () => ({ id: "a" })), getAgentConfigForConnection: vi.fn(() => ({ followUpEnabled: true })) }));
import { getAllFollowUps, getPendingFollowUps, getActiveFollowUpsForLead, startFollowUpSequence, restartFollowUpSequence, markSent, cancelFollowUpsForPhone, scheduleFollowUp } from "../followups";
import type { Lead } from "../leads";
let directory: string, cwd: string;
beforeEach(async () => { cwd = process.cwd(); directory = await mkdtemp(path.join(tmpdir(), "tp-followups-")); process.chdir(directory); });
afterEach(async () => { process.chdir(cwd); await rm(directory, { recursive: true, force: true }); });
const steps = [{ id: "first", delayHours: 1, message: "first" }, { id: "second", delayHours: 2, message: "second" }];
describe("follow-up sequences", () => {
  it("lists only this lead's jobs when another funnel has the same telephone", async () => {
    await startFollowUpSequence("a","44999999999",steps,"x");
    await startFollowUpSequence("a","44999999999",steps,"y");
    const jobs=await getActiveFollowUpsForLead({id:"lead-x",clientId:"a",funnelId:"f-x",phone:"44999999999"} as Lead);
    expect(jobs).toHaveLength(1);expect(jobs[0].connId).toBe("x");
  });
  it("does not create two starts for the same phone, channel and step", async () => {
    await startFollowUpSequence("a", "+55 (44) 99999-9999", steps, "x");
    await startFollowUpSequence("a", "44999999999", steps, "x");
    expect(await getPendingFollowUps("a")).toHaveLength(1);
  });
  it("does not restart a completed sequence after another reply", async () => {
    await startFollowUpSequence("a", "44999999999", steps, "x");
    await markSent((await getPendingFollowUps("a"))[0].id);
    await restartFollowUpSequence("a", "44999999999", steps, "x");
    const next = (await getPendingFollowUps("a"))[0];
    expect(next.stepId).toBe("second");
    await markSent(next.id);
    await restartFollowUpSequence("a", "44999999999", steps, "x");
    expect(await getPendingFollowUps("a")).toEqual([]);
  });
  it("reschedules only the selected channel", async () => {
    await startFollowUpSequence("a", "44999999999", steps, "x");
    await startFollowUpSequence("a", "44999999999", steps, "y");
    await cancelFollowUpsForPhone("a", "5544999999999", "x");
    const pending = await getPendingFollowUps("a");
    expect(pending).toHaveLength(1);
    expect(pending[0].connId).toBe("y");
  });
  it("rejects an invalid schedule instead of leaving an unprocessable job", async () => {
    await expect(scheduleFollowUp({ clientId: "a", phone: "44999999999", scheduledAt: "invalid", message: "x", type: "followup" })).rejects.toThrow();
    expect(await getAllFollowUps()).toEqual([]);
  });
});
