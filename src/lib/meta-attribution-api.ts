import { metaId } from "./lead-attribution";
export type MetaAttributionHints = { adId: string | null; adSetId: string | null; campaignId: string | null };
export type MetaAttributionDetails = {
  campaignId?: string; campaignName?: string; adSetId?: string; adSetName?: string; adId?: string; adName?: string;
};
export async function resolveMetaAttribution(
  hints: MetaAttributionHints, accounts: string[], token: string,
): Promise<{ details: MetaAttributionDetails; complete: boolean }> {
  const allowed = new Set(accounts.map(id => id.replace(/^act_/, "")));
  if (!token || !allowed.size) throw Error("integration_unavailable");
  type ObjectInfo = { id: string; name: string; account_id: string; campaign_id?: string; campaign?: { id: string; name: string }; adset?: { id: string; name: string } };
  async function get(id: string, fields: string): Promise<ObjectInfo> {
    if (!metaId(id)) throw Error("invalid_id");
    const url = new URL("https://graph.facebook.com/v26.0/" + id);
    url.searchParams.set("fields", fields);
    // Tokens stay out of URLs and sanitized errors.
    const response = await fetch(url, { headers: { Authorization: "Bearer " + token }, cache: "no-store", signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw Error("provider_unavailable");
    const data = await response.json() as ObjectInfo;
    if (typeof data.name !== "string" || !data.name.trim()) throw Error("incomplete_response");
    if (data.id !== id || !allowed.has(data.account_id)) throw Error("account_mismatch");
    return data;
  }
  if (hints.adId) {
    const ad = await get(hints.adId, "id,name,account_id,campaign{id,name},adset{id,name}");
    if (!ad.campaign?.id || !ad.adset?.id || !ad.campaign.name || !ad.adset.name
      || hints.campaignId && ad.campaign.id !== hints.campaignId
      || hints.adSetId && ad.adset.id !== hints.adSetId) throw Error("hierarchy_mismatch");
    return { details: { adId: ad.id, adName: ad.name, adSetId: ad.adset.id, adSetName: ad.adset.name, campaignId: ad.campaign.id, campaignName: ad.campaign.name }, complete: true };
  }
  if (hints.adSetId) {
    const adset = await get(hints.adSetId, "id,name,account_id,campaign{id,name}");
    if (!adset.campaign?.id || !adset.campaign.name || hints.campaignId && adset.campaign.id !== hints.campaignId) throw Error("hierarchy_mismatch");
    return { details: { adSetId: adset.id, adSetName: adset.name, campaignId: adset.campaign.id, campaignName: adset.campaign.name }, complete: true };
  }
  if (hints.campaignId) {
    const campaign = await get(hints.campaignId, "id,name,account_id");
    return { details: { campaignId: campaign.id, campaignName: campaign.name }, complete: true };
  }
  return { details: {}, complete: true };
}
