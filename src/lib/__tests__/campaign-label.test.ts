import { describe, expect, it } from "vitest";
import { campaignLabel, readableCampaignName } from "../campaign-label";

describe("campaign labels", () => {
  it("uses the actual provider name instead of an ID", () => {
    expect(campaignLabel({adPlatform:"meta",campaignName:"123",campaignId:"123"},{meta:{"123":"Portões · Novembro"}})).toBe("Portões · Novembro");
  });
  it("keeps Google and Meta IDs separate", () => {
    expect(campaignLabel({adPlatform:"google",utmCampaign:"123"},{meta:{"123":"Meta"},google:{"123":"Google pesquisa"}})).toBe("Google pesquisa");
  });
  it("preserves a captured human name and ignores medium/source placeholders", () => {
    expect(campaignLabel({campaignName:"g",utmCampaign:"Pesquisa%20local"})).toBe("Pesquisa local");
    expect(readableCampaignName("cpc")).toBeNull();
    expect(readableCampaignName("{{campaign.name}}")).toBeNull();
    expect(readableCampaignName("12025218749123")).toBeNull();
  });
  it("does not guess from an unknown or conflicting provider ID", () => {
    expect(campaignLabel({campaignId:"123",campaignName:"123"},{meta:{"123":"Other"}})).toBeNull();
    expect(campaignLabel({adPlatform:"google",campaignId:"123"},{google:{"123":null}})).toBeNull();
  });
  it("preserves a provider-confirmed name even when the actual name is numeric", () => {
    expect(campaignLabel({adPlatform:"meta",campaignId:"123"},{meta:{"123":"2026"}})).toBe("2026");
  });
});
