import { Campaign, CampaignMetrics, DailyMetrics, Alert, AccountSummary } from "@/types";

// ─── Thresholds de decisão ────────────────────────────────────────────────────
export const THRESHOLDS = {
  HIGH_CPA: 80,        // BRL — CPA acima disso é alerta
  LOW_ROAS: 1.5,       // ROAS abaixo disso é alerta
  HIGH_FREQUENCY: 4.0, // frequência acima disso = fadiga de criativo
  LOW_CTR: 0.5,        // CTR% abaixo disso é alerta
  BUDGET_USED: 0.95,   // 95% do orçamento diário usado
};

// ─── Formatadores ──────────────────────────────────────────────────────────────
export function formatCurrency(value: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 2,
  }).format(value);
}

export function formatNumber(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return value.toLocaleString("pt-BR");
}

export function formatPercent(value: number): string {
  return `${value.toFixed(2)}%`;
}

export function formatROAS(value: number): string {
  return `${value.toFixed(2)}x`;
}

// ─── Cálculo de métricas derivadas ────────────────────────────────────────────
export function calculateMetrics(raw: {
  impressions: number;
  clicks: number;
  spend: number;
  conversions: number;
  revenue: number;
  reach: number;
}): CampaignMetrics {
  const { impressions, clicks, spend, conversions, revenue, reach } = raw;
  return {
    impressions,
    clicks,
    spend,
    conversions,
    revenue,
    reach,
    frequency: reach > 0 ? impressions / reach : 0,
    ctr: impressions > 0 ? (clicks / impressions) * 100 : 0,
    cpc: clicks > 0 ? spend / clicks : 0,
    cpm: impressions > 0 ? (spend / impressions) * 1000 : 0,
    cpa: conversions > 0 ? spend / conversions : 0,
    roas: spend > 0 ? revenue / spend : 0,
    conversionRate: clicks > 0 ? (conversions / clicks) * 100 : 0,
  };
}

// ─── Gerador de alertas ───────────────────────────────────────────────────────
export function generateAlerts(campaigns: Campaign[]): Alert[] {
  const alerts: Alert[] = [];

  campaigns.forEach((c) => {
    const m = c.metrics;

    if (c.status !== "ACTIVE") return;

    // CPA alto
    if (m.cpa > THRESHOLDS.HIGH_CPA && m.conversions > 0) {
      alerts.push({
        id: `${c.id}-high-cpa`,
        campaignId: c.id,
        campaignName: c.name,
        platform: c.platform,
        type: "HIGH_CPA",
        severity: m.cpa > THRESHOLDS.HIGH_CPA * 2 ? "critical" : "warning",
        message: `CPA de ${formatCurrency(m.cpa)} está acima do limite de ${formatCurrency(THRESHOLDS.HIGH_CPA)}`,
        recommendation:
          "Revise os públicos-alvo, criativos e páginas de destino. Considere pausar conjuntos de anúncios com baixa performance.",
        value: m.cpa,
        threshold: THRESHOLDS.HIGH_CPA,
      });
    }

    // ROAS baixo
    if (m.roas < THRESHOLDS.LOW_ROAS && m.spend > 50) {
      alerts.push({
        id: `${c.id}-low-roas`,
        campaignId: c.id,
        campaignName: c.name,
        platform: c.platform,
        type: "LOW_ROAS",
        severity: m.roas < 1 ? "critical" : "warning",
        message: `ROAS de ${formatROAS(m.roas)} está abaixo do mínimo de ${formatROAS(THRESHOLDS.LOW_ROAS)}`,
        recommendation:
          "Verifique a qualidade do tráfego e o funil de conversão. Teste diferentes ofertas ou ajuste o público.",
        value: m.roas,
        threshold: THRESHOLDS.LOW_ROAS,
      });
    }

    // Frequência alta (Meta)
    if (c.platform === "meta" && m.frequency > THRESHOLDS.HIGH_FREQUENCY) {
      alerts.push({
        id: `${c.id}-high-freq`,
        campaignId: c.id,
        campaignName: c.name,
        platform: c.platform,
        type: "HIGH_FREQUENCY",
        severity: m.frequency > 6 ? "critical" : "warning",
        message: `Frequência de ${m.frequency.toFixed(1)} indica fadiga de criativo`,
        recommendation:
          "Renove os criativos da campanha. Expanda o público ou crie um novo conjunto de anúncios com peças diferentes.",
        value: m.frequency,
        threshold: THRESHOLDS.HIGH_FREQUENCY,
      });
    }

    // CTR baixo
    if (m.ctr < THRESHOLDS.LOW_CTR && m.impressions > 1000) {
      alerts.push({
        id: `${c.id}-low-ctr`,
        campaignId: c.id,
        campaignName: c.name,
        platform: c.platform,
        type: "LOW_CTR",
        severity: "warning",
        message: `CTR de ${formatPercent(m.ctr)} está abaixo do esperado`,
        recommendation:
          "Os criativos não estão gerando interesse. Teste novos títulos, imagens ou vídeos com CTAs mais diretos.",
        value: m.ctr,
        threshold: THRESHOLDS.LOW_CTR,
      });
    }

    // Orçamento quase esgotado
    const budgetUsed = m.spend / c.dailyBudget;
    if (budgetUsed >= THRESHOLDS.BUDGET_USED) {
      alerts.push({
        id: `${c.id}-budget`,
        campaignId: c.id,
        campaignName: c.name,
        platform: c.platform,
        type: "BUDGET_EXHAUSTED",
        severity: "info",
        message: `${Math.round(budgetUsed * 100)}% do orçamento diário utilizado`,
        recommendation:
          "Considere aumentar o orçamento diário se a campanha está performando bem, para não perder veiculação.",
        value: m.spend,
        threshold: c.dailyBudget,
      });
    }
  });

  // Ordena: critical > warning > info
  return alerts.sort((a, b) => {
    const order = { critical: 0, warning: 1, info: 2 };
    return order[a.severity] - order[b.severity];
  });
}

// ─── Resumo consolidado de conta ──────────────────────────────────────────────
export function buildAccountSummary(
  campaigns: Campaign[],
  platform: Campaign["platform"],
  accountName: string
): AccountSummary {
  const filtered = campaigns.filter((c) => c.platform === platform);
  const active = filtered.filter((c) => c.status === "ACTIVE");

  const totalSpend = filtered.reduce((s, c) => s + c.metrics.spend, 0);
  const totalConversions = filtered.reduce((s, c) => s + c.metrics.conversions, 0);
  const totalImpressions = filtered.reduce((s, c) => s + c.metrics.impressions, 0);
  const totalClicks = filtered.reduce((s, c) => s + c.metrics.clicks, 0);
  const totalRevenue = filtered.reduce((s, c) => s + c.metrics.revenue, 0);

  return {
    platform,
    accountName,
    totalSpend,
    totalConversions,
    totalImpressions,
    totalClicks,
    avgRoas: totalSpend > 0 ? totalRevenue / totalSpend : 0,
    avgCpa: totalConversions > 0 ? totalSpend / totalConversions : 0,
    activeCampaigns: active.length,
  };
}
