import { describe, it, expect, vi, afterEach } from "vitest";
import { attributionPlatform, metaId, metaAttributionHints, normalizeLeadAttribution, preserveCapturedAttribution } from "../lead-attribution";
import { campaignLabel, campaignPlatform } from "../campaign-label";
import { resolveMetaAttribution } from "../meta-attribution-api";
const campaignId = "123456789012345678", adId = "123456789012345679", adSetId = "123456789012345680";
const lead = { source: "form" as const, utmSource: " ig ", utmMedium: "paid_social", utmCampaign: campaignId, utmContent: adId, utmTerm: adSetId, campaignName: campaignId };
afterEach(() => vi.unstubAllGlobals());
describe("captured attribution", () => {
  it.each(["ig", "IG", "instagram", "facebook", "fb", "meta", "an", "messenger"])("recognizes Meta source %s in ingestion and labels", source => {
    expect(attributionPlatform({ utmSource: source })).toBe("meta");
    expect(campaignPlatform({ utmSource: source })).toBe("meta");
  });
  it("keeps capture channel and original UTM IDs while separating numeric campaign names", () => {
    const result = normalizeLeadAttribution(lead);
    expect(result).toMatchObject({ source: "form", adPlatform: "meta", campaignId, campaignName: null, utmCampaign: campaignId, utmContent: adId, utmTerm: adSetId });
    expect(metaAttributionHints(result)).toEqual({ campaignId, adId, adSetId });
    expect(campaignLabel(result)).toBeNull();
    expect(normalizeLeadAttribution(result)).toEqual(result);
  });
  it("preserves Google and does not infer Meta IDs from its numeric UTMs", () => {
    expect(attributionPlatform({ gclid: "click", fbclid: "old", utmSource: "google" })).toBe("google");
    expect(metaAttributionHints({ adPlatform: "google", utmCampaign: campaignId })).toBeNull();
    expect(attributionPlatform({ utmSource: "newsletter" })).toBeNull();
  });
  it("ignores placeholders, unsafe Number IDs and ordinary UTM text", () => {
    expect(metaId(Number(adId))).toBeNull();
    expect(metaId("{{ad.id}}")).toBeNull();
    expect(metaAttributionHints({ utmSource: "ig", utmContent: "hero", customFields: { utm_id: campaignId } })).toEqual({ campaignId, adId: null, adSetId: null });
  });
  it("preserves the first captured attribution on automatic resubmission", () => {
    const previous = normalizeLeadAttribution({ ...lead, campaignName: "First campaign" });
    const patch = preserveCapturedAttribution(previous, { utmSource: "google", gclid: "later", utmCampaign: "987654321012345678", campaignName: "Later campaign" });
    expect(patch).toEqual({});
    expect(preserveCapturedAttribution({}, lead)).toEqual(lead);
  });
});
describe("verified provider labels", () => {
  function response(account = "1000000", campaign = campaignId) {
    return { id: adId, name: "Ad", account_id: account, campaign: { id: campaign, name: "Campaign" }, adset: { id: adSetId, name: "Ad set" } };
  }
  it("resolves the full hierarchy with account ownership and keeps credentials out of URLs", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json(response()));
    vi.stubGlobal("fetch", fetcher);
    expect(await resolveMetaAttribution({ campaignId, adId, adSetId }, ["act_1000000"], "test-secret")).toEqual({ complete: true, details: { campaignId, campaignName: "Campaign", adSetId, adSetName: "Ad set", adId, adName: "Ad" } });
    expect(String(fetcher.mock.calls[0][0])).not.toContain("test-secret");
    expect(fetcher.mock.calls[0][1].signal).toBeDefined();
  });
  it("rejects ads belonging to another client account", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(response("2000000"))));
    await expect(resolveMetaAttribution({ campaignId, adId, adSetId }, ["1000000"], "secret")).rejects.toThrow("account_mismatch");
  });
  it("rejects conflicting campaign IDs instead of mixing two touches", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(response("1000000", "999999999999999999"))));
    await expect(resolveMetaAttribution({ campaignId, adId, adSetId }, ["1000000"], "secret")).rejects.toThrow("hierarchy_mismatch");
  });
  it("sanitizes outages and never leaks the provider response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("private provider diagnostics", { status: 503 })));
    await expect(resolveMetaAttribution({ campaignId, adId, adSetId }, ["1000000"], "secret")).rejects.toThrow(/^provider_unavailable$/);
  });
  it("can resolve campaign-only evidence without inventing an ad", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ id: campaignId, name: "Campaign", account_id: "1000000" })));
    expect((await resolveMetaAttribution({ campaignId, adId: null, adSetId: null }, ["1000000"], "secret")).details).toEqual({ campaignId, campaignName: "Campaign" });
  });
});
