type Attribution = { campaignName?: string | null; campaignId?: string | null; utmCampaign?: string | null; adPlatform?: string | null; utmSource?: string | null };
export type CampaignCatalog = Record<string, Record<string, string | null>>;
export function readableCampaignName(value?: string | null): string | null {
  if (typeof value !== "string" || !value) return null;
  let name = value.trim();
  try { name = decodeURIComponent(name); } catch { /* Keep a literal campaign name with an unmatched percent sign. */ }
  if (!name || /^\d+$/.test(name) || /\{\{|\}\}/.test(name) || /^(?:g|google|meta|facebook|instagram|fb|cpc|ppc|paid|paid_social|social|search|display)$/i.test(name)) return null;
  return name;
}
export function campaignPlatform(lead: Attribution): "meta" | "google" | null {
  if (lead.adPlatform === "meta" || lead.adPlatform === "google") return lead.adPlatform;
  const source = lead.utmSource?.toLowerCase().trim();
  return source === "google" ? "google" : ["meta", "facebook", "instagram", "fb"].includes(source ?? "") ? "meta" : null;
}
export function campaignLabel(lead: Attribution, catalog: CampaignCatalog = {}): string | null {
  const platform = campaignPlatform(lead);
  // Prefer a confirmed current provider name when a campaign ID is known.
  if (platform) for (const id of [lead.campaignId, lead.campaignName, lead.utmCampaign]) {
    const code = typeof id === "string" ? id.trim() : typeof id === "number" ? String(id) : "";
    if (/^\d+$/.test(code)) {
      const confirmed = catalog[platform]?.[code];
      if (typeof confirmed === "string" && confirmed.trim()) return confirmed.trim();
    }
  }
  return readableCampaignName(lead.campaignName) ?? readableCampaignName(lead.utmCampaign);
}
