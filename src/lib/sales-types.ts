// Tipos e funções puras compartilhadas entre server e client

export type CampaignSalesStats = {
  count: number;
  revenue: number;
  platform: "meta" | "google" | null;
};

export function normalizeCampaignName(name: string): string {
  return name.toLowerCase().trim().replace(/\s+/g, " ");
}
