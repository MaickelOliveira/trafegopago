import { beforeEach, afterEach, expect, it, vi } from "vitest";
const db = vi.hoisted(() => ({ leads: [] as Record<string, unknown>[], documents: {} as Record<string, unknown>, resolve: vi.fn(), clients: [{ id: "client", adAccounts: [{ id: "1000000", platform: "meta" }] }] }));
vi.mock("../clients", () => ({ getClients: async () => structuredClone(db.clients), getConfig: async () => ({ metaToken: "synthetic" }) }));
vi.mock("../document-store", () => ({
  withDataTransaction: async (fn: () => unknown) => fn(),
  readDocument: async (key: string, fallback: unknown) => structuredClone(db.documents[key] ?? fallback),
  writeDocument: async (key: string, data: unknown) => { db.documents[key] = structuredClone(data); },
}));
vi.mock("../record-store", () => ({
  readRecordList: async (_: string, filter?: { id?: string }) => structuredClone(db.leads.filter(l => !filter?.id || l.id === filter.id)),
  writeRecordList: async (_: string, rows: Record<string, unknown>[]) => { for (const row of rows) db.leads[db.leads.findIndex(l => l.id === row.id)] = structuredClone(row); },
}));
vi.mock("../meta-attribution-api", () => ({ resolveMetaAttribution: db.resolve }));
const campaignId = "123456789012345678", adId = "123456789012345679", adSetId = "123456789012345680";
const seed = () => ({ id: "one", clientId: "client", funnelId: "funnel", source: "form", utmSource: "ig", utmMedium: "paid_social", utmCampaign: campaignId, utmContent: adId, utmTerm: adSetId, campaignName: campaignId, status: "proposal", aiPaused: true, updatedAt: "2026-01-01", customFields: { consentimento_medicao: "negado" } });
const details = { campaignId, campaignName: "Campaign", adId, adName: "Ad", adSetId, adSetName: "Ad set" };
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-01-01")); db.leads = [seed()]; db.documents = {}; db.resolve.mockReset().mockResolvedValue({ details, complete: true }); });
afterEach(() => vi.useRealTimers());
it("repairs legacy rows and future clients without changing consent, workflow or conversation dates", async () => {
  const { processMetaAttribution } = await import("../meta-attribution-worker");
  expect((await processMetaAttribution()).changed).toBeGreaterThan(0);
  expect(db.leads[0]).toMatchObject({ ...details, adPlatform: "meta", status: "proposal", aiPaused: true, updatedAt: "2026-01-01", source: "form", customFields: { consentimento_medicao: "negado" } });
  db.clients.push({ id: "future", adAccounts: [{ id: "2000000", platform: "meta" }] });
  db.leads.push({ ...seed(), id: "new", clientId: "future" });
  await processMetaAttribution();
  expect(db.resolve).toHaveBeenLastCalledWith(expect.anything(), ["2000000"], "synthetic");
});
it("persists outage backoff and recovers on a later tick without resubmitting a form", async () => {
  db.resolve.mockRejectedValueOnce(Error("temporary"));
  const { processMetaAttribution } = await import("../meta-attribution-worker");
  await processMetaAttribution();
  expect(db.leads[0].adPlatform).toBe("meta");
  expect(db.leads[0].utmCampaign).toBe(campaignId);
  await processMetaAttribution();
  expect(db.resolve).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(60001);
  await processMetaAttribution();
  expect(db.leads[0].campaignName).toBe("Campaign");
});
it("reuses durable verified cache for later leads and is idempotent", async () => {
  const { processMetaAttribution } = await import("../meta-attribution-worker");
  await processMetaAttribution();
  db.leads.push({ ...seed(), id: "later" });
  await processMetaAttribution();
  expect(db.resolve).toHaveBeenCalledTimes(1);
  expect(db.leads[1].adName).toBe("Ad");
  expect((await processMetaAttribution()).changed).toBe(0);
});
it("does not apply a stale response after a lead's ownership or evidence changes", async () => {
  db.resolve.mockImplementationOnce(async () => { db.leads[0].clientId = "someone-else"; return { details, complete: true }; });
  const { processMetaAttribution } = await import("../meta-attribution-worker");
  await processMetaAttribution();
  expect(db.leads[0].adName).toBeUndefined();
});
it("a durable lease prevents a second process from claiming the same request", async () => {
  db.resolve.mockRejectedValueOnce(Error("offline"));
  const { processMetaAttribution } = await import("../meta-attribution-worker");
  await processMetaAttribution();
  const state = db.documents["meta-attribution-state.json"] as { entries: Record<string, { nextAttemptAt: number; leaseUntil: number }> };
  for (const entry of Object.values(state.entries)) { entry.nextAttemptAt = 0; entry.leaseUntil = Date.now() + 120000; }
  await processMetaAttribution();
  expect(db.resolve).toHaveBeenCalledTimes(1);
});
