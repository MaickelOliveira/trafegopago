import { describe, expect, it } from "vitest";
import { followUpWeeklyLimit, nextAllowedFollowUpTime, validateFollowUpConfig } from "../followup-policy";
import type { AgentConfig } from "../clients";

const config = { enabled: true, followUpEnabled: true, followUps: [] } as AgentConfig;
const utc = (value: string) => Date.parse(value);

describe("follow-up send window", () => {
  it("keeps a weekday time inside the 09:00–18:00 São Paulo window", () => {
    const instant = utc("2026-11-10T17:00:00Z"); // terça, 14h em São Paulo
    expect(nextAllowedFollowUpTime(instant, config)).toBe(instant);
  });
  it("moves an evening message to the next business morning", () => {
    expect(new Date(nextAllowedFollowUpTime(utc("2026-11-10T22:00:00Z"), config)).toISOString()).toBe("2026-11-11T12:00:00.000Z");
  });
  it("skips the weekend and respects a custom send window", () => {
    const custom = { ...config, followUpSendStart: "10:30", followUpSendEnd: "16:00" };
    expect(new Date(nextAllowedFollowUpTime(utc("2026-11-07T15:00:00Z"), custom)).toISOString()).toBe("2026-11-09T13:30:00.000Z");
  });
  it("limits follow-ups to at most two per seven days", () => {
    expect(followUpWeeklyLimit(config)).toBe(2);
    expect(followUpWeeklyLimit({ ...config, followUpMaxPer7Days: 1 })).toBe(1);
  });
  it("rejects activating an empty sequence and non-template official messages", () => {
    expect(validateFollowUpConfig({ ...config, followUpEnabled: true }, false)).toMatch(/etapas/);
    expect(validateFollowUpConfig({ ...config, followUps: [{ id: "one", delayHours: 24, message: "Olá", messageType: "text" }] }, true)).toMatch(/modelo/);
  });
});
