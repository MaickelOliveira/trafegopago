import { describe, expect, it } from "vitest";
import { transitionAllowed } from "../kanban-agent";
import type { Lead } from "../leads";
import type { Funnel } from "../funnels";
const lead = { clientId: "a", funnelId: "f", status: "new" } as Lead;
const funnel = { id: "f", clientId: "a", columns: [{ id: "new", allowedTransitions: ["qualified"] }, { id: "qualified" }, { id: "won" }, { id: "manual", blockAutoMove: true }] } as Funnel;
describe("automatic Kanban policy", () => {
  it("allows only the configured next stage in the same client and funnel", () => {
    expect(transitionAllowed(lead, funnel, "qualified")).toBe(true);
    expect(transitionAllowed(lead, funnel, "won")).toBe(false);
    expect(transitionAllowed(lead, { ...funnel, clientId: "other" }, "qualified")).toBe(false);
    expect(transitionAllowed(lead, { ...funnel, id: "other" }, "qualified")).toBe(false);
  });
  it("respects manual-only source/destination columns, missing targets and no-op moves", () => {
    expect(transitionAllowed(lead, funnel, "manual")).toBe(false);
    expect(transitionAllowed({ ...lead, status: "manual" }, funnel, "qualified")).toBe(false);
    expect(transitionAllowed(lead, funnel, "missing")).toBe(false);
    expect(transitionAllowed(lead, funnel, "new")).toBe(false);
  });
});
