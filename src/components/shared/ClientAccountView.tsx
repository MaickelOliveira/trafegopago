"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { clsx } from "clsx";
import { MetricsChart } from "@/components/dashboard/MetricsChart";
import { formatCurrency, formatNumber, formatPercent } from "@/lib/metrics";
import { getPrimaryResult, getFunnelSteps, type FunnelType } from "@/lib/result";
import { StatusToggle } from "@/components/shared/StatusToggle";
import type { MetaCampaign } from "@/lib/meta-api";

type AdAccount = { id: string; name: string; platform: string };
type Client = { id: string; name: string; color: string; logoUrl?: string; cplTarget: number; funnelType?: FunnelType; adAccounts: AdAccount[] };

const DATE_PRESETS = [
  { label: "Hoje",        value: "today" },
  { label: "Ontem",       value: "yesterday" },
  { label: "7 dias",      value: "last_7d" },
  { label: "14 dias",     value: "last_14d" },
  { label: "30 dias",     value: "last_30d" },
  { label: "Este mês",    value: "this_month" },
  { label: "Mês passado", value: "last_month" },
  { label: "Máximo",      value: "maximum" },
];

const statusColors: Record<string, string> = {
  ACTIVE: "bg-green-100 text-green-700",
  PAUSED: "bg-slate-100 text-slate-500",
  ARCHIVED: "bg-orange-100 text-orange-600",
};
const statusLabel: Record<string, string> = {
  ACTIVE: "Ativa",
  PAUSED: "Pausada",
  ARCHIVED: "Arquivada",
};

export function ClientAccountView({
  client,
  role,
}: {
  client: Client;
  role: "manager" | "client";
}) {
  const [selectedAccount, setSelectedAccount] = useState(client.adAccounts[0]);
  const [datePreset, setDatePreset] = useState("last_7d");
  const [campaigns, setCampaigns] = useState<MetaCampaign[]>([]);
  const [dailyData, setDailyData] = useState<{ date: string; spend: number }[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<"ALL" | "ACTIVE" | "PAUSED">("ALL");
  const [budgetModal, setBudgetModal] = useState<{ id: string; name: string; current: number | null } | null>(null);

  const basePath =
    role === "manager"
      ? `/gestor/${client.id}`
      : `/cliente/${selectedAccount?.id}`;

  useEffect(() => {
    if (!selectedAccount) return;
    setLoading(true);
    const qs = new URLSearchParams({ datePreset });

    Promise.all([
      fetch(`/api/meta/${selectedAccount.id}/campaigns?${qs}`).then((r) => r.json()),
      fetchDailyData(selectedAccount.id, datePreset),
    ])
      .then(([camps, daily]) => {
        setCampaigns(Array.isArray(camps) ? camps : []);
        setDailyData(daily);
      })
      .finally(() => setLoading(false));
  }, [selectedAccount, datePreset]);

  async function fetchDailyData(accountId: string, preset: string) {
    const today = new Date();
    const fmt = (d: Date) => d.toISOString().split("T")[0];
    let since = "";
    const until = fmt(today);
    if (preset === "today") { since = until; }
    else if (preset === "last_7d") { const d = new Date(today); d.setDate(d.getDate() - 7); since = fmt(d); }
    else if (preset === "last_30d") { const d = new Date(today); d.setDate(d.getDate() - 30); since = fmt(d); }
    else if (preset === "last_60d") { const d = new Date(today); d.setDate(d.getDate() - 60); since = fmt(d); }
    else return [];

    const res = await fetch(`/api/meta/${accountId}/insights?since=${since}&until=${until}&daily=1`);
    return res.ok ? res.json() : [];
  }

  function sortCampaigns(list: MetaCampaign[]) {
    const score = (c: MetaCampaign) => {
      if (!c.insights || c.insights.spend === 0) return Infinity;
      const r = getPrimaryResult(c.insights);
      if (r.cost !== null) return r.cost;
      return c.insights.cpm;
    };
    return [...list].sort((a, b) => {
      if (a.status === "ACTIVE" && b.status !== "ACTIVE") return -1;
      if (a.status !== "ACTIVE" && b.status === "ACTIVE") return 1;
      return score(a) - score(b);
    });
  }

  const filtered = sortCampaigns(
    campaigns.filter((c) => filter === "ALL" || c.status === filter)
  );
  const totalSpend = campaigns.reduce((s, c) => s + (c.insights?.spend || 0), 0);
  const activeCampaigns = campaigns.filter((c) => c.status === "ACTIVE").length;

  // KPI agregado: soma o resultado primário de cada campanha
  const totalPurchases    = campaigns.reduce((s, c) => s + (c.insights?.purchases || 0), 0);
  const totalLeads        = campaigns.reduce((s, c) => s + (c.insights?.leads || 0), 0);
  const totalConversations = campaigns.reduce((s, c) => s + (c.insights?.conversations || 0), 0);
  const totalRevenue      = campaigns.reduce((s, c) => s + (c.insights?.revenue || 0), 0);

  // Resultado dominante da conta
  const funnelType: FunnelType = client.funnelType ?? "leads";
  const dominantResult =
    funnelType === "sales" ? "purchase" :
    funnelType === "traffic" ? "click" :
    totalLeads > 0 ? "lead" :
    totalConversations > 0 ? "conversation" : "none";

  const totalResults =
    dominantResult === "purchase" ? totalPurchases :
    dominantResult === "lead" ? totalLeads :
    totalConversations;

  const avgCostPerResult = totalResults > 0 ? totalSpend / totalResults : 0;
  const overallRoas = totalSpend > 0 && totalRevenue > 0 ? totalRevenue / totalSpend : null;
  const granaNoBolso = funnelType === "sales" && totalRevenue > 0 ? totalRevenue - totalSpend : null;

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto">
      {/* Header */}
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <span
            className="relative flex h-10 w-10 items-center justify-center rounded-xl text-lg font-bold text-white overflow-hidden"
            style={client.logoUrl ? undefined : { backgroundColor: client.color }}
          >
            {client.logoUrl ? (
              <Image src={client.logoUrl} alt={client.name} fill className="object-cover" />
            ) : (
              client.name.charAt(0)
            )}
          </span>
          <div>
            <h1 className="text-xl font-bold text-slate-900">{client.name}</h1>
            <p className="text-sm text-slate-500">CPL alvo: R$ {client.cplTarget}</p>
          </div>
        </div>

        {/* Account selector */}
        {client.adAccounts.length > 1 && (
          <div className="flex items-center gap-2 flex-wrap">
            {client.adAccounts.map((acc) => (
              <button
                key={acc.id}
                onClick={() => setSelectedAccount(acc)}
                className={clsx(
                  "rounded-lg border px-3 py-1.5 text-sm transition",
                  selectedAccount?.id === acc.id
                    ? "border-blue-500 bg-blue-50 text-blue-700 font-medium"
                    : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
                )}
              >
                {acc.platform === "meta" ? "📘" : "🔵"} {acc.name}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Date preset */}
      <div className="mb-6 flex items-center gap-2">
        {DATE_PRESETS.map((p) => (
          <button
            key={p.value}
            onClick={() => setDatePreset(p.value)}
            className={clsx(
              "rounded-lg px-3 py-1.5 text-sm transition",
              datePreset === p.value
                ? "bg-slate-900 text-white font-medium"
                : "bg-white border border-slate-200 text-slate-600 hover:border-slate-300"
            )}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* KPIs */}
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KPI label="Investido" value={formatCurrency(totalSpend)} />
        <KPI
          label={dominantResult === "purchase" ? "Compras" : dominantResult === "lead" ? "Leads" : "Conversas"}
          value={totalResults > 0 ? formatNumber(totalResults) : "—"}
          sub={overallRoas ? `ROAS ${overallRoas.toFixed(2)}x` : totalRevenue > 0 ? `Receita ${formatCurrency(totalRevenue)}` : undefined}
          variant={overallRoas ? (overallRoas >= 2 ? "success" : "danger") : "default"}
        />
        <KPI label="Campanhas ativas" value={String(activeCampaigns)} />
        {granaNoBolso !== null ? (
          <KPI
            label="No bolso"
            value={formatCurrency(granaNoBolso)}
            sub={`Receita ${formatCurrency(totalRevenue)} − Invest. ${formatCurrency(totalSpend)}`}
            variant={granaNoBolso > 0 ? "success" : "danger"}
          />
        ) : (
          <KPI
            label={dominantResult === "purchase" ? "Custo/compra" : "Custo/resultado"}
            value={avgCostPerResult > 0 ? formatCurrency(avgCostPerResult) : "—"}
            sub={`Alvo: R$ ${client.cplTarget}`}
            variant={avgCostPerResult > 0 && avgCostPerResult <= client.cplTarget ? "success" : avgCostPerResult > client.cplTarget ? "danger" : "default"}
          />
        )}
      </div>

      {/* Chart */}
      {dailyData.length > 1 && (
        <div className="mb-6 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-4 text-sm font-semibold text-slate-700">Gasto diário</h2>
          <MetricsChart data={dailyData} />
        </div>
      )}

      {/* Campaign table */}
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3.5">
          <h2 className="text-sm font-semibold text-slate-700">Campanhas</h2>
          <div className="flex gap-1.5">
            {(["ALL", "ACTIVE", "PAUSED"] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={clsx(
                  "rounded-md px-2.5 py-1 text-xs transition",
                  filter === f
                    ? "bg-slate-900 text-white"
                    : "text-slate-500 hover:bg-slate-100"
                )}
              >
                {f === "ALL" ? "Todas" : f === "ACTIVE" ? "Ativas" : "Pausadas"}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-16 text-sm text-slate-400">
            Carregando...
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-16 text-center text-sm text-slate-400">
            Nenhuma campanha encontrada
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50 text-left text-xs font-semibold text-slate-500">
                  {role === "manager" && <th className="px-4 py-3">On/Off</th>}
                  <th className="px-5 py-3">Campanha</th>
                  <th className="px-4 py-3 text-right">Budget/dia</th>
                  <th className="px-4 py-3 text-right">Investido</th>
                  <th className="px-4 py-3 text-right">Alcance</th>
                  <th className="px-4 py-3 text-right">CTR</th>
                  <th className="px-4 py-3 text-right">Funil</th>
                  <th className="px-4 py-3 text-right">Custo/result.</th>
                  {role === "manager" && <th className="px-4 py-3" />}
                </tr>
              </thead>
              <tbody>
                {filtered.map((c) => {
                  const funnelType = client.funnelType ?? "leads";
                  const result = getPrimaryResult(c.insights ?? null, funnelType);
                  const steps = getFunnelSteps(c.insights ?? null, funnelType, client.cplTarget);
                  const costBad = result.cost !== null && result.cost > client.cplTarget;
                  return (
                    <tr key={c.id} className="border-b border-slate-50 hover:bg-slate-50 transition">
                      {role === "manager" && (
                        <td className="px-4 py-3.5">
                          <StatusToggle
                            id={c.id}
                            status={c.status}
                            onToggled={(s) => setCampaigns((prev) =>
                              prev.map((x) => x.id === c.id ? { ...x, status: s } : x)
                            )}
                            disabled={c.status !== "ACTIVE" && c.status !== "PAUSED"}
                          />
                        </td>
                      )}
                      <td className="px-5 py-3.5">
                        <Link
                          href={`${basePath}/campanhas/${c.id}`}
                          className="font-medium text-slate-800 hover:text-blue-600 transition line-clamp-2"
                        >
                          {c.name}
                        </Link>
                        <p className="text-xs text-slate-400">{c.objective?.replace("OUTCOME_", "")}</p>
                      </td>
                      <td className="px-4 py-3.5 text-right text-slate-600">
                        {c.dailyBudget ? formatCurrency(c.dailyBudget) : "—"}
                      </td>
                      <td className="px-4 py-3.5 text-right font-medium text-slate-800">
                        {c.insights ? formatCurrency(c.insights.spend) : "—"}
                      </td>
                      <td className="px-4 py-3.5 text-right text-slate-600">
                        {c.insights ? formatNumber(c.insights.reach) : "—"}
                      </td>
                      <td className="px-4 py-3.5 text-right text-slate-600">
                        {c.insights ? formatPercent(c.insights.ctr) : "—"}
                      </td>
                      <td className="px-4 py-3.5 text-right">
                        {steps.length > 0 ? (
                          <div className="flex items-center justify-end gap-2">
                            {steps.map((step, i) => (
                              <div key={step.label} className="flex items-center gap-2">
                                {i > 0 && <span className="text-slate-300 text-xs">→</span>}
                                <div className="text-right">
                                  <p className={clsx("font-semibold text-sm",
                                    step.highlight === "success" ? "text-green-600" :
                                    step.highlight === "danger" ? "text-red-600" : "text-slate-800"
                                  )}>
                                    {step.label === "ROAS"
                                      ? `${step.value.toFixed(2)}x`
                                      : step.isCurrency
                                      ? formatCurrency(step.value)
                                      : formatNumber(step.value)}
                                  </p>
                                  <p className="text-xs text-slate-400">{step.label}</p>
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : <span className="text-slate-400">—</span>}
                      </td>
                      <td className={clsx("px-4 py-3.5 text-right font-semibold",
                        costBad ? "text-red-600" : result.cost !== null ? "text-green-600" : "text-slate-400"
                      )}>
                        {result.cost !== null ? formatCurrency(result.cost) : "—"}
                      </td>
                      {role === "manager" && (
                        <td className="px-3 py-3.5">
                          <button
                            onClick={() => setBudgetModal({ id: c.id, name: c.name, current: c.dailyBudget })}
                            title="Editar orçamento"
                            className="rounded-lg p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 transition"
                          >
                            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                          </button>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      {budgetModal && (
        <BudgetModal
          id={budgetModal.id}
          name={budgetModal.name}
          current={budgetModal.current}
          onClose={() => setBudgetModal(null)}
          onSaved={(newBudget) => {
            setCampaigns((prev) =>
              prev.map((c) => c.id === budgetModal.id ? { ...c, dailyBudget: newBudget } : c)
            );
            setBudgetModal(null);
          }}
        />
      )}
      </div>
    </div>
  );
}

function BudgetModal({ id, name, current, onClose, onSaved }: {
  id: string; name: string; current: number | null;
  onClose: () => void; onSaved: (v: number) => void;
}) {
  const [value, setValue] = useState(current ? String(current) : "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  async function save() {
    const budget = parseFloat(value);
    if (!budget || budget <= 0) { setError("Digite um valor válido"); return; }
    setSaving(true); setError("");
    try {
      const res = await fetch(`/api/meta/budget/${id}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ budget, type: "daily" }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Erro ao salvar"); return; }
      onSaved(budget);
    } catch { setError("Erro de conexão"); }
    finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="w-full max-w-sm rounded-2xl bg-white shadow-xl p-6" onClick={(e) => e.stopPropagation()}>
        <h2 className="font-semibold text-slate-900 mb-1">Editar orçamento diário</h2>
        <p className="text-sm text-slate-500 mb-5 line-clamp-2">{name}</p>
        <div className="space-y-4">
          {current && <p className="text-xs text-slate-400">Atual: R$ {current.toFixed(2)}/dia</p>}
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-400">R$</span>
            <input type="number" value={value} onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && save()} autoFocus min="1" step="0.01"
              className="w-full rounded-lg border border-slate-200 pl-9 pr-3 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              placeholder="0,00" />
          </div>
          {error && <p className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-600">{error}</p>}
          <div className="flex gap-3 pt-1">
            <button onClick={onClose} className="flex-1 rounded-lg border border-slate-200 py-2.5 text-sm text-slate-600 hover:bg-slate-50 transition">Cancelar</button>
            <button onClick={save} disabled={saving} className="flex-1 rounded-lg bg-blue-600 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60 transition">
              {saving ? "Salvando..." : "Salvar"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function KPI({
  label,
  value,
  sub,
  variant = "default",
}: {
  label: string;
  value: string;
  sub?: string;
  variant?: "default" | "success" | "danger" | "warning";
}) {
  const variantStyles = {
    default:  "border-slate-200 bg-white",
    success:  "border-green-200 bg-green-50",
    danger:   "border-red-200 bg-red-50",
    warning:  "border-orange-200 bg-orange-50",
  };
  const valueStyles = {
    default:  "text-slate-900",
    success:  "text-green-700",
    danger:   "text-red-700",
    warning:  "text-orange-700",
  };

  return (
    <div className={clsx("rounded-xl border p-4 shadow-sm", variantStyles[variant])}>
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className={clsx("mt-1 text-xl font-bold", valueStyles[variant])}>{value}</p>
      {sub && <p className="mt-0.5 text-xs text-slate-400">{sub}</p>}
    </div>
  );
}
