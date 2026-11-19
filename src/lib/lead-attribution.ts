import type { Lead } from "./leads";
import { readableCampaignName } from "./campaign-label";

export type AttributionInput = Partial<Lead>;
const META_SOURCES = new Set(["meta", "facebook", "instagram", "fb", "ig", "an", "messenger"]);
export function attributionPlatform(lead: AttributionInput): "meta" | "google" | null {
  if (lead.adPlatform === "meta" || lead.adPlatform === "google") return lead.adPlatform;
  if (lead.gclid) return "google";
  const source = lead.utmSource?.trim().toLowerCase();
  if (lead.fbclid || META_SOURCES.has(source ?? "")) return "meta";
  return source === "google" ? "google" : null;
}
export function metaId(value: unknown): string | null {
  // Never convert provider IDs to Number: they exceed JS safe integer precision.
  return typeof value === "string" && /^\d{6,30}$/.test(value.trim()) ? value.trim() : null;
}
export function metaAttributionHints(lead: AttributionInput) {
  if (attributionPlatform(lead) !== "meta") return null;
  const custom = lead.customFields ?? {};
  return {
    adId: metaId(lead.adId) ?? metaId(custom.ad_id) ?? metaId(custom.adId) ?? metaId(lead.utmContent),
    adSetId: metaId(lead.adSetId) ?? metaId(custom.adset_id) ?? metaId(custom.adSetId) ?? metaId(lead.utmTerm),
    campaignId: metaId(lead.campaignId) ?? metaId(custom.campaign_id) ?? metaId(custom.utm_id) ?? metaId(lead.utmCampaign) ?? metaId(lead.campaignName),
  };
}
/** Safe local classification. Numeric UTM content/term remain hints until Meta verifies them. */
export function normalizeLeadAttribution<T extends AttributionInput>(lead: T): T {
  const platform = attributionPlatform(lead);
  const hints = metaAttributionHints(lead);
  return {
    ...lead,
    ...(platform ? { adPlatform: platform } : {}),
    ...(hints?.campaignId && !lead.campaignId ? { campaignId: hints.campaignId } : {}),
    ...(platform === "meta" && metaId(lead.campaignName) ? { campaignName: null } : {}),
  };
}
export const ATTRIBUTION_FIELDS = [
  "adPlatform", "campaignId", "campaignName", "adSetId", "adSetName", "adId", "adName", "adSourceUrl",
  "utmSource", "utmMedium", "utmCampaign", "utmContent", "utmTerm", "fbclid", "gclid", "fbp",
] as const;
/** Automatic resubmissions may fill gaps, never replace a captured first touch. Manual edits use updateLead. */
export function preserveCapturedAttribution(previous: AttributionInput, incoming: AttributionInput): AttributionInput {
  const patch = { ...incoming };
  if (attributionPlatform(previous) || previous.utmCampaign || previous.adId || previous.campaignId) {
    for (const key of ATTRIBUTION_FIELDS) {
      if (previous[key] != null && previous[key] !== "") delete patch[key];
    }
    const before = metaAttributionHints(previous), after = metaAttributionHints(incoming);
    const changed = attributionPlatform(incoming) && attributionPlatform(previous) !== attributionPlatform(incoming)
      || before && after && (before.campaignId && after.campaignId && before.campaignId !== after.campaignId
        || before.adId && after.adId && before.adId !== after.adId);
    if (changed) for (const key of ATTRIBUTION_FIELDS) delete patch[key];
  }
  return patch;
}
export function hasReadableAttributionName(value: string | null | undefined) {
  return readableCampaignName(value) !== null;
}
