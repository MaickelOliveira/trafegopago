"use client";

import { Campaign } from "@/types";
import { formatCurrency, formatNumber, formatPercent, formatROAS } from "@/lib/metrics";
import { clsx } from "clsx";
import { ArrowUpDown } from "lucide-react";
import { useState, useMemo } from "react";

interface CampaignTableProps {
  campaigns: Campaign[];
}

type SortField = "name" | "spend" | "roas" | "cpa" | "ctr" | "conversions" | "impressions";
type SortDir = "asc" | "desc";

const statusStyles: Record<string, string> = {
  ACTIVE: "bg-green-100 text-green-700",
  PAUSED: "bg-gray-100 text-gray-600",
  ARCHIVED: "bg-slate-100 text-slate-500",
  DELETED: "bg-red-100 text-red-600",
};

const statusLabel: Record<string, string> = {
  ACTIVE: "Ativa",
  PAUSED: "Pausada",
  ARCHIVED: "Arquivada",
  DELETED: "Excluída",
};

const platformStyles: Record<string, string> = {
  meta: "bg-blue-100 text-blue-700",
  google: "bg-orange-100 text-orange-700",
};

const platformLabel: Record<string, string> = {
  meta: "Meta",
  google: "Google",
};

export function CampaignTable({ campaigns }: CampaignTableProps) {
  const [sortField, setSortField] = useState<SortField>("spend");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [platformFilter, setPlatformFilter] = useState<string>("ALL");

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDir("desc");
    }
  };

  const filtered = useMemo(() => {
    return campaigns
      .filter((c) => {
        const matchSearch = c.name.toLowerCase().includes(search.toLowerCase());
        const matchStatus = statusFilter === "ALL" || c.status === statusFilter;
        const matchPlatform = platformFilter === "ALL" || c.platform === platformFilter;
        return matchSearch && matchStatus && matchPlatform;
      })
      .sort((a, b) => {
        let aVal: string | number = 0;
        let bVal: string | number = 0;

        if (sortField === "name") {
          aVal = a.name;
          bVal = b.name;
        } else if (sortField === "spend") {
          aVal = a.metrics.spend;
          bVal = b.metrics.spend;
        } else if (sortField === "roas") {
          aVal = a.metrics.roas;
          bVal = b.metrics.roas;
        } else if (sortField === "cpa") {
          aVal = a.metrics.cpa;
          bVal = b.metrics.cpa;
        } else if (sortField === "ctr") {
          aVal = a.metrics.ctr;
          bVal = b.metrics.ctr;
        } else if (sortField === "conversions") {
          aVal = a.metrics.conversions;
          bVal = b.metrics.conversions;
        } else if (sortField === "impressions") {
          aVal = a.metrics.impressions;
          bVal = b.metrics.impressions;
        }

        if (typeof aVal === "string") {
          return sortDir === "asc"
            ? aVal.localeCompare(bVal as string)
            : (bVal as string).localeCompare(aVal);
        }
        return sortDir === "asc"
          ? (aVal as number) - (bVal as number)
          : (bVal as number) - (aVal as number);
      });
  }, [campaigns, search, statusFilter, platformFilter, sortField, sortDir]);

  const SortButton = ({ field, label }: { field: SortField; label: string }) => (
    <button
      onClick={() => handleSort(field)}
      className="flex items-center gap-1 font-semibold text-slate-600 hover:text-slate-900"
    >
      {label}
      <ArrowUpDown
        className={clsx(
          "h-3.5 w-3.5",
          sortField === field ? "text-blue-600" : "text-slate-300"
        )}
      />
    </button>
  );

  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 p-4">
        <input
          type="text"
          placeholder="Buscar campanha..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 min-w-48 rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
        />
        <select
          value={platformFilter}
          onChange={(e) => setPlatformFilter(e.target.value)}
          className="rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-400"
        >
          <option value="ALL">Todas as plataformas</option>
          <option value="meta">Meta Ads</option>
          <option value="google">Google Ads</option>
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-400"
        >
          <option value="ALL">Todos os status</option>
          <option value="ACTIVE">Ativas</option>
          <option value="PAUSED">Pausadas</option>
          <option value="ARCHIVED">Arquivadas</option>
        </select>
        <span className="text-sm text-slate-500">{filtered.length} campanhas</span>
      </div>

      {/* Tabela */}
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50 text-left">
              <th className="px-4 py-3 text-xs"><SortButton field="name" label="Campanha" /></th>
              <th className="px-4 py-3 text-xs">Plataforma</th>
              <th className="px-4 py-3 text-xs">Status</th>
              <th className="px-4 py-3 text-xs"><SortButton field="spend" label="Investido" /></th>
              <th className="px-4 py-3 text-xs"><SortButton field="impressions" label="Impressões" /></th>
              <th className="px-4 py-3 text-xs"><SortButton field="ctr" label="CTR" /></th>
              <th className="px-4 py-3 text-xs"><SortButton field="conversions" label="Conversões" /></th>
              <th className="px-4 py-3 text-xs"><SortButton field="cpa" label="CPA" /></th>
              <th className="px-4 py-3 text-xs"><SortButton field="roas" label="ROAS" /></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((c, i) => {
              const roasBad = c.metrics.roas < 1.5 && c.metrics.spend > 50;
              const cpaBad = c.metrics.cpa > 80 && c.metrics.conversions > 0;

              return (
                <tr
                  key={c.id}
                  className={clsx(
                    "border-b border-slate-50 transition-colors hover:bg-slate-50",
                    i % 2 === 0 ? "bg-white" : "bg-slate-50/40"
                  )}
                >
                  <td className="max-w-xs px-4 py-3">
                    <p className="truncate font-medium text-slate-800">{c.name}</p>
                    <p className="text-xs text-slate-400">{c.accountName}</p>
                  </td>
                  <td className="px-4 py-3">
                    <span className={clsx("rounded-full px-2 py-0.5 text-xs font-medium", platformStyles[c.platform])}>
                      {platformLabel[c.platform]}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={clsx("rounded-full px-2 py-0.5 text-xs font-semibold", statusStyles[c.status])}>
                      {statusLabel[c.status]}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-medium text-slate-800">
                    {formatCurrency(c.metrics.spend)}
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {formatNumber(c.metrics.impressions)}
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {formatPercent(c.metrics.ctr)}
                  </td>
                  <td className="px-4 py-3 font-medium text-slate-800">
                    {c.metrics.conversions.toLocaleString("pt-BR")}
                  </td>
                  <td className={clsx("px-4 py-3 font-semibold", cpaBad ? "text-red-600" : "text-slate-800")}>
                    {c.metrics.conversions > 0 ? formatCurrency(c.metrics.cpa) : "—"}
                  </td>
                  <td className={clsx("px-4 py-3 font-semibold", roasBad ? "text-red-600" : c.metrics.roas >= 3 ? "text-green-600" : "text-slate-800")}>
                    {c.metrics.spend > 0 && c.metrics.revenue > 0 ? formatROAS(c.metrics.roas) : "—"}
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={9} className="py-12 text-center text-slate-400">
                  Nenhuma campanha encontrada
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
