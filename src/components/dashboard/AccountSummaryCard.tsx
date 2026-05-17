"use client";

import { AccountSummary } from "@/types";
import { formatCurrency, formatNumber, formatROAS } from "@/lib/metrics";
import { clsx } from "clsx";

interface AccountSummaryCardProps {
  summary: AccountSummary;
}

const platformConfig: Record<string, { label: string; gradient: string; dot: string }> = {
  meta: {
    label: "Meta Ads",
    gradient: "from-blue-600 to-blue-400",
    dot: "bg-blue-500",
  },
  google: {
    label: "Google Ads",
    gradient: "from-orange-500 to-yellow-400",
    dot: "bg-orange-500",
  },
};

export function AccountSummaryCard({ summary }: AccountSummaryCardProps) {
  const config = platformConfig[summary.platform];

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      {/* Header com gradiente */}
      <div className={clsx("bg-gradient-to-r px-5 py-4 text-white", config.gradient)}>
        <div className="flex items-center gap-2">
          <span className={clsx("h-2 w-2 rounded-full bg-white opacity-80")} />
          <p className="text-sm font-medium opacity-90">{config.label}</p>
        </div>
        <p className="mt-1 text-2xl font-bold">{formatCurrency(summary.totalSpend)}</p>
        <p className="text-xs opacity-80">investido no período</p>
      </div>

      {/* Métricas */}
      <div className="grid grid-cols-2 divide-x divide-y divide-slate-100">
        <Metric label="Conversões" value={summary.totalConversions.toLocaleString("pt-BR")} />
        <Metric label="ROAS médio" value={formatROAS(summary.avgRoas)} highlight={summary.avgRoas >= 3} />
        <Metric label="CPA médio" value={summary.avgCpa > 0 ? formatCurrency(summary.avgCpa) : "—"} />
        <Metric label="Campanhas ativas" value={summary.activeCampaigns.toString()} />
        <Metric label="Impressões" value={formatNumber(summary.totalImpressions)} />
        <Metric label="Cliques" value={formatNumber(summary.totalClicks)} />
      </div>
    </div>
  );
}

function Metric({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="px-4 py-3">
      <p className="text-xs text-slate-500">{label}</p>
      <p className={clsx("mt-0.5 font-semibold", highlight ? "text-green-600" : "text-slate-800")}>
        {value}
      </p>
    </div>
  );
}
