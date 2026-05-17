// Tipos centrais do sistema de gestão de tráfego

export type Platform = "meta" | "google";

export type CampaignStatus = "ACTIVE" | "PAUSED" | "ARCHIVED" | "DELETED";

export type CampaignObjective =
  | "CONVERSIONS"
  | "TRAFFIC"
  | "AWARENESS"
  | "LEAD_GENERATION"
  | "SALES"
  | "APP_INSTALLS";

export interface CampaignMetrics {
  impressions: number;
  clicks: number;
  spend: number;     // em BRL
  conversions: number;
  revenue: number;   // receita gerada (para ROAS)
  reach: number;
  frequency: number;
  ctr: number;       // Click-through rate (%)
  cpc: number;       // Custo por clique (BRL)
  cpm: number;       // Custo por mil impressões (BRL)
  cpa: number;       // Custo por aquisição (BRL)
  roas: number;      // Return on ad spend
  conversionRate: number; // Taxa de conversão (%)
}

export interface Campaign {
  id: string;
  platform: Platform;
  name: string;
  status: CampaignStatus;
  objective: CampaignObjective;
  dailyBudget: number;   // BRL
  lifetimeBudget?: number;
  startDate: string;     // ISO date
  endDate?: string;
  metrics: CampaignMetrics;
  accountName: string;
}

export interface DailyMetrics {
  date: string; // YYYY-MM-DD
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
  ctr: number;
  cpc: number;
  roas: number;
}

export interface Alert {
  id: string;
  campaignId: string;
  campaignName: string;
  platform: Platform;
  type: "HIGH_CPA" | "LOW_ROAS" | "HIGH_FREQUENCY" | "LOW_CTR" | "BUDGET_EXHAUSTED" | "PAUSED_WITH_BUDGET";
  severity: "warning" | "critical" | "info";
  message: string;
  recommendation: string;
  value: number;
  threshold: number;
}

export interface AccountSummary {
  platform: Platform;
  accountName: string;
  totalSpend: number;
  totalConversions: number;
  totalImpressions: number;
  totalClicks: number;
  avgRoas: number;
  avgCpa: number;
  activeCampaigns: number;
}

export interface DateRange {
  from: Date;
  to: Date;
}
