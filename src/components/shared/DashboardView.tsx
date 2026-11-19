"use client";

import { useState, useEffect } from "react";
import { Wallet, Users, MessageSquare, TrendingUp, Target, Trophy, BarChart3 } from "lucide-react";
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  RadialBarChart, RadialBar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ComposedChart, Line,
} from "recharts";
import { clsx } from "clsx";
import { dashboardInsights, loadDashboardData, type DashboardCampaign, type DashboardInsights, type DashboardDaily } from "@/lib/dashboard-data";

type AdAccount = { id: string; name: string; platform: string };
type Client   = { id: string; name: string; color: string; cplTarget: number; funnelType?: string; adAccounts: AdAccount[] };
type CrmLead  = { id: string; name: string; phone: string; realPhone?: string; status: string; funnelId: string; createdAt: string; updatedAt?: string; value?: number | null };

const PALETTE = ["#afe507","#6db8c8","#e0bd79","#9daebc","#c9e985","#78ba9a","#92a6cd","#c7a591","#d4dbcc","#80b5aa"];

function fmt(v: number)  { return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }); }
function fmtK(v: number) { return v >= 1000000 ? `${(v/1000000).toFixed(1)}M` : v >= 1000 ? `${(v/1000).toFixed(1)}k` : v.toLocaleString("pt-BR",{maximumFractionDigits:2}); }

// ── Tooltip customizado ──────────────────────────────────────────────────────
const Tip = ({ active, payload, label }: { active?: boolean; payload?: { name: string; value: number; color: string }[]; label?: string }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-2xl border border-white/20 bg-slate-900/95 backdrop-blur px-4 py-3 shadow-2xl text-sm">
      {label && <p className="text-slate-400 text-xs mb-2">{label}</p>}
      {payload.map((p) => (
        <div key={p.name} className="flex items-center gap-2.5 py-0.5">
          <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: p.color }} />
          <span className="text-slate-300 text-xs">{p.name}</span>
          <span className="font-bold text-white ml-auto pl-4">
            {p.name.includes("R$") ? fmt(Number(p.value)) : fmtK(Number(p.value))}
          </span>
        </div>
      ))}
    </div>
  );
};

// ── KPI Card ─────────────────────────────────────────────────────────────────
function KPI({ label, value, sub, icon, trend }: {
  label: string; value: string; sub?: string; icon: string;
  trend?: "up" | "down" | "neutral";
}) {
  const Icon = ({"💸":Wallet,"👁️":Users,"✅":MessageSquare,"📈":TrendingUp,"🎯":Target,"🏆":Trophy,"📊":BarChart3,"💰":Wallet} as Record<string,typeof Wallet>)[icon] ?? TrendingUp;
  return (
    <div className="nexo-kpi">
      <div className="relative">
        <div className="flex items-center justify-between mb-4">
          <span className="text-xs font-semibold text-white/70 uppercase tracking-wider">{label}</span>
          <Icon size={19} className="nexo-kpi-icon" />
        </div>
        <p className="text-3xl font-black text-white tracking-tight">{value}</p>
        {sub && (
          <p className="mt-2 flex items-center gap-1 text-xs text-white/60">
            {trend === "up" && <span className="text-emerald-300">↑</span>}
            {trend === "down" && <span className="text-red-300">↓</span>}
            {sub}
          </p>
        )}
      </div>
    </div>
  );
}


// ── Dashboard ─────────────────────────────────────────────────────────────────
export function DashboardView({ client, canManageConnection = false }: { client: Client; canManageConnection?: boolean }) {
  const [selectedAccountId,setSelectedAccountId] = useState<string|undefined>();
  const account=client.adAccounts.find(item=>item.id===selectedAccountId)??client.adAccounts[0];
  const [datePreset, setDatePreset] = useState("last_30d");
  const [campaigns, setCampaigns] = useState<DashboardCampaign[]>([]);
  const [summary,setSummary] = useState<DashboardInsights|null>(null);
  const [adsError,setAdsError] = useState<string|null>(null);
  const [adsReconnect,setAdsReconnect] = useState(false);
  const [crmError,setCrmError] = useState<string|null>(null);
  const [reloadKey,setReloadKey] = useState(0);
  const [daily, setDaily]          = useState<DashboardDaily[]>([]);
  const [loading, setLoading]      = useState(true);
  const [crmLeads, setCrmLeads]    = useState<CrmLead[]>([]);

  const PRESETS = [
    { label: "7d",  value: "last_7d"   },
    { label: "14d", value: "last_14d"  },
    { label: "30d", value: "last_30d"  },
    { label: "Mês", value: "this_month"},
  ];

  useEffect(() => {
    const controller=new AbortController();
    setLoading(true);
    loadDashboardData(account,client.id,datePreset,controller.signal).then(result=>{
      if(controller.signal.aborted)return;
      setCampaigns(result.campaigns);setDaily(result.daily);setSummary(result.summary);
      setAdsError(result.adsError);setAdsReconnect(result.adsReconnect);setCrmError(result.crmError);setCrmLeads(result.crmLeads);
    }).finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return()=>controller.abort();
  },[account,client.id,datePreset,reloadKey]);
  const isGoogle=account?.platform==="google";
  const adsAvailable=summary!==null;
  const totals=summary??dashboardInsights(account?.platform??"meta",null);

  // ── Métricas agregadas ────────────────────────────────────────────────────
  const active          = campaigns.filter((c) => c.status === "ACTIVE");
  const withData        = campaigns.filter((c) => c.insights && c.insights.spend > 0);
  const totalSpend=totals.spend, totalImpressions=totals.impressions, totalReach=totals.reach??0;
  const totalClicks=totals.clicks, totalLeads=totals.leads, totalConversas=totals.conversations;
  const totalPurchases=totals.purchases, totalConversions=totals.conversions, totalRevenue=totals.revenue;
  const totalResults=totalLeads+totalConversas+totalPurchases+totalConversions;
  const metaRoas=totalSpend>0&&totalRevenue>0?totalRevenue/totalSpend:null;

  // ROAS via CRM: faturamento dos leads com status "ganho"
  const crmGanhoValor   = crmLeads.filter(l => l.status === "ganho").reduce((s, l) => s + (l.value ?? 0), 0);
  const crmRoas         = totalSpend > 0 && crmGanhoValor > 0 ? crmGanhoValor / totalSpend : null;

  // Usa pixel Meta se disponível; senão usa faturamento do CRM
  const overallRoas     = metaRoas ?? crmRoas;
  const roasSource = metaRoas ? isGoogle ? "google" : "pixel" : crmRoas ? "crm" : null;

  const avgCtr = totals.ctr;
  const avgCpm = totals.cpm;

  const funnelType = client.funnelType ?? "leads";
  const resultLabel = isGoogle ? "Conversões" : funnelType === "sales" ? "Compras" : totalLeads > 0 ? "Leads" : "Conversas";
  const resultValue = isGoogle ? totalConversions : funnelType === "sales" ? totalPurchases : totalLeads > 0 ? totalLeads : totalConversas;
  const costPerResult   = resultValue > 0 ? totalSpend / resultValue : null;

  // ── Dados para os gráficos ────────────────────────────────────────────────
  const areaData = daily.map((d) => ({
    dia: d.date.slice(5),
    "Investido R$": parseFloat((d.spend ?? 0).toFixed(2)),
    "Cliques": d.clicks ?? 0,
  }));

  const pieData = withData.slice(0, 7).map((c, i) => ({
    name: c.name.length > 20 ? c.name.slice(0, 20) + "…" : c.name,
    value: parseFloat(c.insights!.spend.toFixed(2)),
    fill: PALETTE[i % PALETTE.length],
  }));

  const barData = [...withData]
    .sort((a, b) => (b.insights?.spend ?? 0) - (a.insights?.spend ?? 0))
    .slice(0, 7)
    .map((c, i) => {
      const res = (c.insights?.leads ?? 0) + (c.insights?.conversations ?? 0) + (c.insights?.purchases ?? 0) + (c.insights?.conversions ?? 0);
      return {
        name: c.name.length > 16 ? c.name.slice(0, 16) + "…" : c.name,
        "Investido R$": parseFloat(c.insights!.spend.toFixed(2)),
        "Resultados": res,
        fill: PALETTE[i % PALETTE.length],
      };
    });

  const roasMeta   = 3;
  const roasPct    = overallRoas ? Math.min((overallRoas / roasMeta) * 100, 120) : 0;
  const roasColor  = overallRoas ? (overallRoas >= roasMeta ? "#34d399" : overallRoas >= 1.5 ? "#fbbf24" : "#f87171") : "#475569";
  const radialData = [{ name: "ROAS", value: roasPct, fill: roasColor }];

  if (loading) return (
    <div className="flex items-center justify-center h-96 bg-slate-950 rounded-3xl mx-6 mt-6">
      <div className="text-center">
        <div className="h-14 w-14 rounded-full border-4 border-indigo-500/30 border-t-indigo-500 animate-spin mx-auto mb-4" />
        <p className="text-sm text-slate-400 font-medium">Carregando dashboard...</p>
      </div>
    </div>
  );

  return (
    <div className="nexo-dashboard min-h-screen bg-slate-950 p-6 lg:p-8 space-y-6">

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-2xl text-xl font-black text-white shadow-lg shadow-black/30"
            style={{ background: `linear-gradient(135deg, ${client.color}, ${client.color}99)` }}>
            {client.name.charAt(0)}
          </span>
          <div>
            <h1 className="text-xl font-bold text-white">{client.name}</h1>
            <p className="text-xs text-slate-400">{adsAvailable ? `${active.length} ativas · ${campaigns.length} campanhas carregadas` : "Indicadores de anúncios indisponíveis"} · Meta: R$ {client.cplTarget}/resultado</p>
          </div>
        </div>
        <div className="nexo-dashboard-controls">
          <div className="nexo-dashboard-account-options" role="group" aria-label="Contas de anúncio">
          {client.adAccounts.length > 1 && client.adAccounts.map((acc) => (
            <button key={acc.id} onClick={() => setSelectedAccountId(acc.id)} aria-pressed={account?.id === acc.id}
              className={clsx("rounded-xl border px-3 py-1.5 text-xs font-semibold transition",
                account?.id === acc.id ? "border-indigo-500 bg-indigo-500/20 text-indigo-300" : "border-white/10 text-slate-400 hover:border-white/20 hover:text-slate-300"
              )}>
              {acc.platform === "google" ? "Google Ads" : acc.platform === "meta" ? "Meta Ads" : acc.platform} · {acc.name}
            </button>
          ))}
          </div>
          <div className="nexo-dashboard-period-options flex rounded-xl border border-white/10 bg-white/5 overflow-hidden" role="group" aria-label="Período dos indicadores">
            {PRESETS.map((p) => (
              <button key={p.value} onClick={() => setDatePreset(p.value)} aria-pressed={datePreset === p.value}
                className={clsx("px-3 py-2 text-xs font-semibold transition",
                  datePreset === p.value ? "bg-indigo-600 text-white" : "text-slate-400 hover:text-white hover:bg-white/10"
                )}>
                {p.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {(adsError||crmError)&&<div role="alert" className="nexo-feedback error nexo-dashboard-feedback"><div>{adsError&&<p>{adsError}</p>}{adsReconnect&&!canManageConnection&&<p>Peça ao gestor para renovar a conexão da agência.</p>}{crmError&&<p>{crmError}</p>}</div>{adsReconnect&&canManageConnection&&<a className="nexo-secondary" href="/api/agent/google-ads-auth">Reconectar Google Ads</a>}<button className="nexo-secondary" onClick={()=>setReloadKey(value=>value+1)}>Tentar novamente</button></div>}
      {/* KPIs */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <KPI label="Investimento" value={adsAvailable?fmt(totalSpend):"—"} sub={adsAvailable?`CPM médio ${fmt(avgCpm)}`:"Dados indisponíveis"} icon="💸" />
        <KPI label={isGoogle?"Impressões":"Alcance total"} value={adsAvailable?fmtK(isGoogle?totalImpressions:totalReach):"—"} sub={adsAvailable?`${isGoogle?fmtK(totalClicks)+" cliques":fmtK(totalImpressions)+" impressões"} · CTR ${avgCtr.toFixed(2)}%`:"Dados indisponíveis"} icon="👁️" />
        <KPI label={resultLabel} value={adsAvailable?fmtK(resultValue):"—"}
          sub={!adsAvailable?"Dados indisponíveis":costPerResult ? `Custo ${fmt(costPerResult)}` : "Sem resultados ainda"} icon="✅"
          trend={costPerResult && costPerResult <= client.cplTarget ? "up" : costPerResult ? "down" : "neutral"} />
        <KPI label="ROAS" value={overallRoas ? `${overallRoas.toFixed(2)}×` : "—"}
          sub={!adsAvailable?"Dados indisponíveis":overallRoas
            ? `${roasSource === "crm" ? "Fatur. CRM" : roasSource === "google" ? "Google Ads" : "Pixel Meta"} · Meta ${roasMeta}× · ${overallRoas >= roasMeta ? "✓ Atingida" : "Abaixo da meta"}`
            : "Registre valor nos leads ganhos"}
          icon={overallRoas && overallRoas >= roasMeta ? "🚀" : "📈"}
          trend={overallRoas ? (overallRoas >= roasMeta ? "up" : "down") : "neutral"} />
      </div>

      {/* Área diária */}
      <div className="rounded-3xl border border-white/10 bg-white/5 p-6 backdrop-blur">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-sm font-bold text-white">Evolução diária</h2>
            <p className="text-xs text-slate-400 mt-0.5">Investimento e cliques no período selecionado</p>
          </div>
          <div className="flex items-center gap-4">
            <span className="flex items-center gap-1.5 text-xs text-slate-400"><span className="h-2.5 w-2.5 rounded-full bg-indigo-400" />Investido</span>
            <span className="flex items-center gap-1.5 text-xs text-slate-400"><span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />Cliques</span>
          </div>
        </div>
        <ResponsiveContainer width="100%" height={200}>
          <AreaChart data={areaData}>
            <defs>
              <linearGradient id="gSpend" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#afe507" stopOpacity={0.5} />
                <stop offset="100%" stopColor="#afe507" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="gClicks" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#34d399" stopOpacity={0.4} />
                <stop offset="100%" stopColor="#34d399" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#ffffff08" />
            <XAxis dataKey="dia" tick={{ fontSize: 11, fill: "#64748b" }} axisLine={false} tickLine={false} interval={4} />
            <YAxis tick={{ fontSize: 11, fill: "#64748b" }} axisLine={false} tickLine={false} />
            <Tooltip content={<Tip />} />
            <Area type="monotone" dataKey="Investido R$" stroke="#afe507" strokeWidth={2.5} fill="url(#gSpend)" dot={false} activeDot={{ r: 5, fill: "#afe507", stroke: "#1e1b4b", strokeWidth: 2 }} />
            <Area type="monotone" dataKey="Cliques" stroke="#34d399" strokeWidth={2.5} fill="url(#gClicks)" dot={false} activeDot={{ r: 5, fill: "#34d399", stroke: "#022c22", strokeWidth: 2 }} />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Funil de conversão */}
        <div className="rounded-3xl border border-white/10 bg-white/5 p-6 backdrop-blur">
          <h2 className="text-sm font-bold text-white mb-1">Funil de conversão</h2>
          <p className="text-xs text-slate-400 mb-4">Queda em cada etapa do funil</p>
          {totalImpressions > 0 ? (() => {
            const steps = [
              { name: "Impressões", value: totalImpressions, fill: "#afe507" },
              ...(!isGoogle?[{ name: "Alcance", value: totalReach, fill: "#38bdf8" }]:[]),
              { name: "Cliques",    value: totalClicks,      fill: "#34d399" },
              ...(isGoogle?[{name:"Conversões",value:totalConversions,fill:"#78ba9a"}]:[]),
              ...(totalConversas > 0 ? [{ name: "Conversas", value: totalConversas, fill: "#a78bfa" }] : totalLeads > 0 ? [{ name: "Leads", value: totalLeads, fill: "#fb923c" }] : []),
              ...(totalPurchases > 0 ? [{ name: "Compras",   value: totalPurchases, fill: "#f472b6" }] : []),
            ].filter((d) => d.value > 0);

            const maxVal   = steps[0].value;
            const W        = 280;
            const stepH    = 52;
            const gap      = 5;
            const totalH   = steps.length * stepH + (steps.length - 1) * gap;

            // Escala visual: mapeia proporcionalmente de 100% (topo) a 52% (fundo mínimo)
            const MIN_W = 0.52;
            const visWidth = (v: number) => {
              const ratio = v / maxVal;
              // Interpolação linear: 1 → 100%, 0 → MIN_W, mantendo forma de funil
              const normalized = MIN_W + (1 - MIN_W) * Math.pow(ratio, 0.22);
              return normalized * W;
            };

            return (
              <>
                <svg viewBox={`0 0 ${W} ${totalH}`} className="w-full">
                  <defs>
                    {steps.map((s, i) => (
                      <linearGradient key={i} id={`fg${i}`} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={s.fill} stopOpacity="0.95" />
                        <stop offset="100%" stopColor={s.fill} stopOpacity="0.65" />
                      </linearGradient>
                    ))}
                  </defs>
                  {steps.map((step, i) => {
                    const topW    = visWidth(step.value);
                    const botW    = i < steps.length - 1 ? visWidth(steps[i + 1].value) : topW * 0.94;
                    const topX    = (W - topW) / 2;
                    const botX    = (W - botW) / 2;
                    const y       = i * (stepH + gap);
                    const cy      = y + stepH / 2;
                    const prev    = i > 0 ? steps[i - 1].value : step.value;
                    const dropPct = i > 0 && prev > 0 ? ((1 - step.value / prev) * 100).toFixed(0) : null;

                    const pts = `${topX},${y} ${topX + topW},${y} ${botX + botW},${y + stepH} ${botX},${y + stepH}`;

                    return (
                      <g key={step.name}>
                        <polygon points={pts} fill={`url(#fg${i})`} rx="6" />
                        {/* Nome */}
                        <text x={W / 2} y={cy - 9} textAnchor="middle" fill="white"
                          fontSize="12" fontWeight="700" style={{ fontFamily: "system-ui" }}>
                          {step.name}
                        </text>
                        {/* Valor */}
                        <text x={W / 2} y={cy + 6} textAnchor="middle"
                          fill="rgba(255,255,255,0.9)" fontSize="13" fontWeight="800"
                          style={{ fontFamily: "system-ui" }}>
                          {fmtK(step.value)}
                        </text>
                        {/* Drop */}
                        {dropPct && (
                          <text x={W / 2} y={cy + 20} textAnchor="middle"
                            fill="rgba(255,255,255,0.45)" fontSize="10"
                            style={{ fontFamily: "system-ui" }}>
                            ↓ {dropPct}% do anterior
                          </text>
                        )}
                      </g>
                    );
                  })}
                </svg>

                <div className="grid grid-cols-2 gap-3 mt-3">
                  <div className="rounded-2xl bg-white/5 p-3 text-center">
                    <p className="text-xs text-slate-400">CTR médio</p>
                    <p className="text-lg font-black text-white">{avgCtr.toFixed(2)}%</p>
                  </div>
                  <div className="rounded-2xl bg-white/5 p-3 text-center">
                    <p className="text-xs text-slate-400">Clique → Resultado</p>
                    <p className="text-lg font-black text-white">
                      {totalClicks > 0 && totalResults > 0 ? ((totalResults / totalClicks) * 100).toFixed(2) : "0"}%
                    </p>
                  </div>
                </div>
              </>
            );
          })() : (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <p className="text-3xl mb-2">📭</p>
              <p className="text-sm text-slate-400">{adsAvailable?"Sem dados de impressões":"Indicadores indisponíveis"}</p>
            </div>
          )}
        </div>

        {/* Pie */}
        <div className="rounded-3xl border border-white/10 bg-white/5 p-6 backdrop-blur">
          <h2 className="text-sm font-bold text-white mb-1">Investimento por campanha</h2>
          <p className="text-xs text-slate-400 mb-2">Distribuição do orçamento</p>
          {pieData.length > 0 ? (
            <>
              <ResponsiveContainer width="100%" height={180}>
                <PieChart>
                  <Pie data={pieData} cx="50%" cy="50%" innerRadius={52} outerRadius={78}
                    paddingAngle={4} dataKey="value" stroke="none">
                    {pieData.map((e, i) => <Cell key={i} fill={e.fill} opacity={0.9} />)}
                  </Pie>
                  <Tooltip formatter={(v) => fmt(Number(v))} contentStyle={{ background: "#0f172a", border: "1px solid #ffffff20", borderRadius: 12, fontSize: 12 }} />
                </PieChart>
              </ResponsiveContainer>
              <div className="space-y-2 mt-2">
                {pieData.map((d, i) => {
                  const pct = totalSpend > 0 ? (d.value / totalSpend * 100).toFixed(0) : "0";
                  return (
                    <div key={i} className="flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: d.fill }} />
                      <span className="text-xs text-slate-400 flex-1 truncate">{d.name}</span>
                      <span className="text-xs text-slate-300 font-semibold">{pct}%</span>
                    </div>
                  );
                })}
              </div>
            </>
          ) : <p className="text-center text-slate-500 py-16 text-sm">{adsAvailable?"Sem dados de investimento":"Indicadores indisponíveis"}</p>}
        </div>

        {/* ROAS Gauge */}
        <div className="rounded-3xl border border-white/10 bg-white/5 p-6 backdrop-blur flex flex-col">
          <h2 className="text-sm font-bold text-white mb-1">ROAS geral</h2>
          <p className="text-xs text-slate-400 mb-2">Meta: {roasMeta}×</p>
          <div className="flex-1 flex flex-col items-center justify-center">
            <div className="relative">
              <ResponsiveContainer width={180} height={180}>
                <RadialBarChart cx="50%" cy="50%" innerRadius="65%" outerRadius="90%"
                  startAngle={210} endAngle={-30} data={radialData}>
                  <RadialBar dataKey="value" cornerRadius={8}
                    background={{ fill: "#ffffff0a" }} />
                </RadialBarChart>
              </ResponsiveContainer>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <p className="text-4xl font-black" style={{ color: roasColor }}>
                  {overallRoas ? overallRoas.toFixed(2) : "—"}
                </p>
                <p className="text-xs text-slate-400 font-medium">ROAS atual</p>
              </div>
            </div>
            <div className="w-full grid grid-cols-2 gap-3 mt-4">
              <div className="rounded-2xl bg-white/5 p-3 text-center">
                <p className="text-xs text-slate-400">{roasSource === "crm" ? "Fatur. CRM (ganho)" : isGoogle ? "Valor de conversões" : "Receita pixel"}</p>
                <p className="text-sm font-bold text-white">{(roasSource === "crm" ? !crmError : adsAvailable) ? fmt(roasSource === "crm" ? crmGanhoValor : totalRevenue) : "—"}</p>
              </div>
              <div className="rounded-2xl bg-white/5 p-3 text-center">
                <p className="text-xs text-slate-400">Investido</p>
                <p className="text-sm font-bold text-white">{adsAvailable ? fmt(totalSpend) : "—"}</p>
              </div>
            </div>
            {roasSource === "crm" && (
              <p className="text-[10px] text-slate-500 text-center mt-2">ROAS calculado via faturamento do CRM</p>
            )}
          </div>
        </div>
      </div>

      {/* ── CRM Section ────────────────────────────────────────────────────── */}
      {(() => {
        const crmTotal    = crmLeads.length;
        const crmEntrada  = crmLeads.filter(l => l.status === "entrada").length;
        const crmGanho    = crmLeads.filter(l => l.status === "ganho").length;
        const crmConv     = crmTotal > 0 ? ((crmGanho / crmTotal) * 100).toFixed(0) : "0";
        const crmValor    = crmLeads.reduce((s, l) => s + (l.value ?? 0), 0);

        // Contagem por status para pipeline
        const stagesMap: Record<string, number> = {};
        for (const l of crmLeads) stagesMap[l.status] = (stagesMap[l.status] ?? 0) + 1;
        const stages = Object.entries(stagesMap)
          .sort((a, b) => b[1] - a[1])
          .map(([name, count], i) => ({ name, count, fill: PALETTE[i % PALETTE.length] }));

        // Últimos 5 leads
        const recent = [...crmLeads]
          .sort((a, b) => new Date(b.updatedAt ?? b.createdAt).getTime() - new Date(a.updatedAt ?? a.createdAt).getTime())
          .slice(0, 5);

        return (
          <>
            <div className="flex items-center gap-3 pt-2">
              <div className="h-px flex-1 bg-white/10" />
              <span className="text-xs font-bold text-slate-400 uppercase tracking-widest">CRM · Pipeline de Leads</span>
              <div className="h-px flex-1 bg-white/10" />
            </div>

            {/* CRM KPIs */}
            <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
              <KPI label="Leads no CRM" value={crmError?"—":String(crmTotal)} sub={`${crmEntrada} novos contatos`} icon="🎯" />
              <KPI label="Ganhos" value={crmError?"—":String(crmGanho)} sub={crmValor > 0 ? `Valor: ${fmt(crmValor)}` : "Sem valor estimado"} icon="🏆" trend={crmGanho > 0 ? "up" : "neutral"} />
              <KPI label="Conversão CRM" value={crmError?"—":`${crmConv}%`} sub={`${crmTotal} leads no total`} icon="📊" trend={Number(crmConv) >= 10 ? "up" : "neutral"} />
              <KPI label="Valor pipeline" value={crmError?"—":fmt(crmLeads.filter(l => l.status !== "perdido").reduce((s, l) => s + (l.value ?? 0), 0))}
                sub="Leads ativos" icon="💰" />
            </div>

            {/* Pipeline + Recentes */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Barras por estágio */}
              <div className="rounded-3xl border border-white/10 bg-white/5 p-6 backdrop-blur">
                <h2 className="text-sm font-bold text-white mb-1">Pipeline por etapa</h2>
                <p className="text-xs text-slate-400 mb-4">Quantidade de leads em cada coluna do funil</p>
                {stages.length > 0 ? (
                  <ResponsiveContainer width="100%" height={200}>
                    <BarChart data={stages} layout="vertical" barSize={18}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#ffffff08" horizontal={false} />
                      <XAxis type="number" tick={{ fontSize: 11, fill: "#64748b" }} axisLine={false} tickLine={false} />
                      <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false} width={80} />
                      <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid #ffffff20", borderRadius: 12, fontSize: 12 }} />
                      <Bar dataKey="count" radius={[0, 8, 8, 0]} name="Leads">
                        {stages.map((s, i) => <Cell key={i} fill={s.fill} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex flex-col items-center justify-center py-12">
                    <p className="text-3xl mb-2">📭</p>
                    <p className="text-sm text-slate-400">Nenhum lead no CRM ainda</p>
                  </div>
                )}
              </div>

              {/* Leads recentes */}
              <div className="rounded-3xl border border-white/10 bg-white/5 p-6 backdrop-blur">
                <h2 className="text-sm font-bold text-white mb-1">Leads recentes</h2>
                <p className="text-xs text-slate-400 mb-4">Últimas entradas no pipeline</p>
                {recent.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12">
                    <p className="text-3xl mb-2">👤</p>
                    <p className="text-sm text-slate-400">Nenhum lead ainda</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {recent.map(l => {
                      const days = Math.floor((Date.now() - new Date(l.updatedAt ?? l.createdAt).getTime()) / 86400000);
                      return (
                        <div key={l.id} className="flex items-center gap-3 rounded-2xl bg-white/5 px-4 py-3">
                          <div className="h-8 w-8 rounded-full flex items-center justify-center text-sm font-bold text-white flex-shrink-0"
                            style={{ background: `${PALETTE[l.name.charCodeAt(0) % PALETTE.length]}44` }}>
                            {(l.name?.[0] ?? "?").toUpperCase()}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-white truncate">{l.name}</p>
                            <p className="text-xs text-slate-500">{l.realPhone ?? l.phone}</p>
                          </div>
                          <div className="text-right flex-shrink-0">
                            <span className="text-[10px] font-bold uppercase tracking-wide px-2 py-1 rounded-lg bg-white/10 text-slate-300">
                              {l.status}
                            </span>
                            <p className="text-[10px] text-slate-500 mt-1">{days === 0 ? "hoje" : `${days}d`}</p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </>
        );
      })()}

      {/* Comparativo de campanhas */}
      <div className="rounded-3xl border border-white/10 bg-white/5 p-6 backdrop-blur">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-sm font-bold text-white">Comparativo de campanhas</h2>
            <p className="text-xs text-slate-400 mt-0.5">Investimento (barras) e resultados (linha)</p>
          </div>
        </div>
        {barData.length > 0 ? (
          <ResponsiveContainer width="100%" height={240}>
            <ComposedChart data={barData} barGap={6}>
              <defs>
                {PALETTE.map((c, i) => (
                  <linearGradient key={i} id={`cb${i}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={c} stopOpacity={0.9} />
                    <stop offset="100%" stopColor={c} stopOpacity={0.5} />
                  </linearGradient>
                ))}
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#ffffff08" />
              <XAxis dataKey="name" tick={{ fontSize: 11, fill: "#64748b" }} axisLine={false} tickLine={false} />
              <YAxis yAxisId="left" tick={{ fontSize: 11, fill: "#64748b" }} axisLine={false} tickLine={false} />
              <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11, fill: "#64748b" }} axisLine={false} tickLine={false} />
              <Tooltip content={<Tip />} />
              <Bar yAxisId="left" dataKey="Investido R$" radius={[8, 8, 0, 0]} barSize={32}>
                {barData.map((_, i) => <Cell key={i} fill={`url(#cb${i % PALETTE.length})`} />)}
              </Bar>
              <Line yAxisId="right" type="monotone" dataKey="Resultados" stroke="#f472b6"
                strokeWidth={3} dot={{ fill: "#f472b6", r: 6, stroke: "#0f172a", strokeWidth: 2 }}
                activeDot={{ r: 8, fill: "#f472b6" }} />
            </ComposedChart>
          </ResponsiveContainer>
        ) : <p className="text-center text-slate-500 py-12 text-sm">{adsAvailable?"Sem dados de campanhas":"Indicadores indisponíveis"}</p>}
      </div>
    </div>
  );
}
