import { Campaign, DailyMetrics } from "@/types";
import { calculateMetrics } from "./metrics";
import { subDays, format } from "date-fns";

// ─── Dados de demonstração (sem API real) ─────────────────────────────────────
export function getDemoCampaigns(): Campaign[] {
  return [
    // ── META ──────────────────────────────────────────────────────────────────
    {
      id: "meta-001",
      platform: "meta",
      name: "Conversões — Produto Principal",
      status: "ACTIVE",
      objective: "CONVERSIONS",
      dailyBudget: 300,
      startDate: "2026-04-01",
      accountName: "Conta Meta Principal",
      metrics: calculateMetrics({
        impressions: 142000,
        clicks: 3200,
        spend: 2850,
        conversions: 42,
        revenue: 8400,
        reach: 58000,
      }),
    },
    {
      id: "meta-002",
      platform: "meta",
      name: "Remarketing — Carrinho Abandonado",
      status: "ACTIVE",
      objective: "CONVERSIONS",
      dailyBudget: 150,
      startDate: "2026-04-05",
      accountName: "Conta Meta Principal",
      metrics: calculateMetrics({
        impressions: 48000,
        clicks: 980,
        spend: 820,
        conversions: 31,
        revenue: 6200,
        reach: 9800,
      }),
    },
    {
      id: "meta-003",
      platform: "meta",
      name: "Tráfego — Blog SEO",
      status: "ACTIVE",
      objective: "TRAFFIC",
      dailyBudget: 80,
      startDate: "2026-04-10",
      accountName: "Conta Meta Principal",
      metrics: calculateMetrics({
        impressions: 89000,
        clicks: 1100,
        spend: 620,
        conversions: 4,
        revenue: 400,
        reach: 62000,
      }),
    },
    {
      id: "meta-004",
      platform: "meta",
      name: "Leads — Formulário Nativo",
      status: "PAUSED",
      objective: "LEAD_GENERATION",
      dailyBudget: 120,
      startDate: "2026-03-15",
      endDate: "2026-04-20",
      accountName: "Conta Meta Principal",
      metrics: calculateMetrics({
        impressions: 54000,
        clicks: 720,
        spend: 960,
        conversions: 8,
        revenue: 1600,
        reach: 41000,
      }),
    },
    {
      id: "meta-005",
      platform: "meta",
      name: "Awareness — Marca",
      status: "ACTIVE",
      objective: "AWARENESS",
      dailyBudget: 200,
      startDate: "2026-04-15",
      accountName: "Conta Meta Principal",
      metrics: calculateMetrics({
        impressions: 310000,
        clicks: 1550,
        spend: 1800,
        conversions: 0,
        revenue: 0,
        reach: 285000,
      }),
    },
    // ── GOOGLE ────────────────────────────────────────────────────────────────
    {
      id: "google-001",
      platform: "google",
      name: "Search — Palavras-chave Produto",
      status: "ACTIVE",
      objective: "CONVERSIONS",
      dailyBudget: 250,
      startDate: "2026-04-01",
      accountName: "Google Ads Principal",
      metrics: calculateMetrics({
        impressions: 28000,
        clicks: 2100,
        spend: 3100,
        conversions: 55,
        revenue: 11000,
        reach: 28000,
      }),
    },
    {
      id: "google-002",
      platform: "google",
      name: "Shopping — Catálogo Completo",
      status: "ACTIVE",
      objective: "SALES",
      dailyBudget: 400,
      startDate: "2026-04-01",
      accountName: "Google Ads Principal",
      metrics: calculateMetrics({
        impressions: 95000,
        clicks: 3800,
        spend: 4200,
        conversions: 78,
        revenue: 14040,
        reach: 95000,
      }),
    },
    {
      id: "google-003",
      platform: "google",
      name: "Display — Remarketing RLSA",
      status: "ACTIVE",
      objective: "CONVERSIONS",
      dailyBudget: 120,
      startDate: "2026-04-08",
      accountName: "Google Ads Principal",
      metrics: calculateMetrics({
        impressions: 210000,
        clicks: 1260,
        spend: 980,
        conversions: 19,
        revenue: 3800,
        reach: 195000,
      }),
    },
    {
      id: "google-004",
      platform: "google",
      name: "Performance Max — eCommerce",
      status: "ACTIVE",
      objective: "SALES",
      dailyBudget: 500,
      startDate: "2026-04-01",
      accountName: "Google Ads Principal",
      metrics: calculateMetrics({
        impressions: 180000,
        clicks: 5400,
        spend: 6800,
        conversions: 95,
        revenue: 22800,
        reach: 165000,
      }),
    },
    {
      id: "google-005",
      platform: "google",
      name: "YouTube — Vídeo Produto",
      status: "PAUSED",
      objective: "AWARENESS",
      dailyBudget: 180,
      startDate: "2026-03-20",
      endDate: "2026-04-18",
      accountName: "Google Ads Principal",
      metrics: calculateMetrics({
        impressions: 420000,
        clicks: 2100,
        spend: 2400,
        conversions: 12,
        revenue: 2400,
        reach: 380000,
      }),
    },
  ];
}

export function getDemoDailyMetrics(days = 30): DailyMetrics[] {
  const today = new Date();
  const data: DailyMetrics[] = [];

  for (let i = days - 1; i >= 0; i--) {
    const date = subDays(today, i);
    const dayOfWeek = date.getDay(); // 0=Dom, 6=Sab
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
    const base = isWeekend ? 0.7 : 1.0;
    const noise = () => 0.85 + Math.random() * 0.3;

    const impressions = Math.round(850000 * base * noise());
    const clicks = Math.round(impressions * 0.018 * base * noise());
    const spend = Math.round(clicks * 2.1 * noise() * 100) / 100;
    const conversions = Math.round(clicks * 0.025 * base * noise());
    const revenue = conversions * 200 * (0.9 + Math.random() * 0.4);

    data.push({
      date: format(date, "yyyy-MM-dd"),
      impressions,
      clicks,
      spend: parseFloat(spend.toFixed(2)),
      conversions,
      ctr: parseFloat(((clicks / impressions) * 100).toFixed(2)),
      cpc: parseFloat((spend / clicks).toFixed(2)),
      roas: parseFloat((revenue / spend).toFixed(2)),
    });
  }

  return data;
}
