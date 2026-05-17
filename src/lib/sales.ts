import { readFileSync, writeFileSync, existsSync } from "fs";
import path from "path";
import { normalizeCampaignName, type CampaignSalesStats } from "./sales-types";

export type { CampaignSalesStats } from "./sales-types";
export { normalizeCampaignName } from "./sales-types";

export type TintimSale = {
  id: string;
  phone: string;
  clientId: string | null;
  platform: "meta" | "google" | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmContent: string | null;
  utmTerm: string | null;
  saleAmount: number | null;
  statusName: string | null;
  createdAt: string;
};

const FILE = path.join(process.cwd(), "data", "sales.json");

function load(): TintimSale[] {
  try {
    if (!existsSync(FILE)) return [];
    return JSON.parse(readFileSync(FILE, "utf-8"));
  } catch {
    return [];
  }
}

function save(sales: TintimSale[]) {
  writeFileSync(FILE, JSON.stringify(sales, null, 2));
}

export function getSales(): TintimSale[] {
  return load();
}

export function upsertSale(sale: TintimSale) {
  const all = load();
  const idx = all.findIndex((s) => s.id === sale.id);
  if (idx >= 0) {
    all[idx] = sale;
  } else {
    all.push(sale);
  }
  save(all);
}

export function getSalesStatsByDateRange(
  since: string,
  until: string,
  clientId?: string
): Record<string, CampaignSalesStats> {
  const all = load().filter((s) => {
    const d = s.createdAt.slice(0, 10);
    if (d < since || d > until) return false;
    if (clientId && s.clientId !== clientId) return false;
    return true;
  });

  const result: Record<string, CampaignSalesStats> = {};
  for (const s of all) {
    const key = normalizeCampaignName(s.utmCampaign ?? "");
    if (!key) continue;
    if (!result[key]) result[key] = { count: 0, revenue: 0, platform: s.platform };
    result[key].count++;
    result[key].revenue += s.saleAmount ?? 0;
  }
  return result;
}
