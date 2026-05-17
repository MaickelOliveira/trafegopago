import type { MetaInsights } from "./meta-api";
import { formatCurrency, formatNumber } from "./metrics";

export type FunnelType = "leads" | "sales" | "traffic";

export type PrimaryResult = {
  type: "purchase" | "lead" | "conversation" | "click" | "view" | "none";
  label: string;
  count: number;
  cost: number | null;
  costLabel: string;
  extra: string | null;
};

export type FunnelStep = {
  label: string;
  value: number;
  cost: number | null;
  highlight?: "success" | "danger" | "none";
  isCurrency?: boolean;
};

// Passos do funil para colunas de tabela e cards
export function getFunnelSteps(
  ins: MetaInsights | null,
  funnelType: FunnelType,
  cprTarget: number
): FunnelStep[] {
  if (!ins) return [];

  if (funnelType === "sales") {
    const steps: FunnelStep[] = [];
    if (ins.addToCart > 0)
      steps.push({ label: "Carrinho", value: ins.addToCart, cost: null });
    if (ins.checkouts > 0)
      steps.push({ label: "Checkout", value: ins.checkouts, cost: null });
    steps.push({
      label: "Compras",
      value: ins.purchases,
      cost: ins.costPerPurchase,
      highlight: ins.costPerPurchase !== null
        ? (ins.costPerPurchase <= cprTarget ? "success" : "danger")
        : "none",
    });
    if (ins.roas !== null)
      steps.push({ label: "ROAS", value: ins.roas, cost: null });
    if (ins.revenue > 0) {
      const bolso = ins.revenue - ins.spend;
      steps.push({
        label: "💰 No bolso",
        value: bolso,
        cost: null,
        highlight: bolso > 0 ? "success" : "danger",
        isCurrency: true,
      });
    }
    return steps;
  }

  if (funnelType === "traffic") {
    const steps: FunnelStep[] = [];
    if (ins.linkClicks > 0)
      steps.push({ label: "Cliques", value: ins.linkClicks,
        cost: ins.cpc > 0 ? ins.cpc : null });
    if (ins.landingPageViews > 0)
      steps.push({ label: "Visitas LP", value: ins.landingPageViews,
        cost: ins.landingPageViews > 0 ? ins.spend / ins.landingPageViews : null });
    return steps;
  }

  // leads (default)
  const steps: FunnelStep[] = [];
  if (ins.landingPageViews > 0)
    steps.push({ label: "Visitas LP", value: ins.landingPageViews, cost: null });
  if (ins.leads > 0)
    steps.push({
      label: "Leads",
      value: ins.leads,
      cost: ins.costPerLead,
      highlight: ins.costPerLead !== null
        ? (ins.costPerLead <= cprTarget ? "success" : "danger")
        : "none",
    });
  if (ins.conversations > 0)
    steps.push({
      label: "Conversas",
      value: ins.conversations,
      cost: ins.costPerConversation,
      highlight: ins.costPerConversation !== null
        ? (ins.costPerConversation <= cprTarget ? "success" : "danger")
        : "none",
    });
  return steps;
}

// Resultado principal (KPI + ordenação)
export function getPrimaryResult(
  ins: MetaInsights | null,
  funnelType: FunnelType = "leads"
): PrimaryResult {
  if (!ins) return { type: "none", label: "—", count: 0, cost: null, costLabel: "—", extra: null };

  if (funnelType === "sales") {
    return {
      type: "purchase",
      label: "Compras",
      count: ins.purchases,
      cost: ins.costPerPurchase,
      costLabel: "Custo/compra",
      extra: ins.roas ? `ROAS ${ins.roas.toFixed(2)}x`
        : ins.revenue > 0 ? `Receita ${formatCurrency(ins.revenue)}` : null,
    };
  }

  if (funnelType === "traffic") {
    return {
      type: "click",
      label: "Cliques",
      count: ins.linkClicks,
      cost: ins.cpc > 0 ? ins.cpc : null,
      costLabel: "CPC",
      extra: ins.landingPageViews > 0
        ? `${formatNumber(ins.landingPageViews)} visitas LP` : null,
    };
  }

  // leads: prioriza leads > conversas
  if (ins.leads > 0) {
    return { type: "lead", label: "Leads", count: ins.leads,
      cost: ins.costPerLead, costLabel: "CPL", extra: null };
  }
  if (ins.conversations > 0) {
    return { type: "conversation", label: "Conversas", count: ins.conversations,
      cost: ins.costPerConversation, costLabel: "Custo/msg", extra: null };
  }
  return { type: "none", label: "—", count: 0, cost: null, costLabel: "—", extra: null };
}

export function formatResult(r: PrimaryResult): string {
  if (r.type === "none") return "—";
  return formatNumber(r.count);
}
