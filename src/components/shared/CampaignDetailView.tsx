"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { clsx } from "clsx";
import { formatCurrency, formatNumber, formatPercent } from "@/lib/metrics";
import { getPrimaryResult, getFunnelSteps, type FunnelType } from "@/lib/result";
import { StatusToggle } from "@/components/shared/StatusToggle";
import type { MetaAdSet, MetaAd } from "@/lib/meta-api";

type Client = { id: string; name: string; color: string; cplTarget: number; funnelType?: FunnelType };

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
};

export function CampaignDetailView({
  client,
  accountId,
  campaignId,
  role,
}: {
  client: Client;
  accountId: string;
  campaignId: string;
  role: "manager" | "client";
}) {
  const backPath = role === "manager" ? `/gestor/${client.id}` : `/cliente`;
  const [datePreset, setDatePreset] = useState("last_7d");
  const [adsets, setAdsets] = useState<MetaAdSet[]>([]);
  const [expandedAdset, setExpandedAdset] = useState<string | null>(null);
  const [adsMap, setAdsMap] = useState<Record<string, MetaAd[]>>({});
  const [loading, setLoading] = useState(false);
  const [loadingAds, setLoadingAds] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<MetaAd | null>(null);
  const [budgetModal, setBudgetModal] = useState<{ id: string; name: string; current: number | null; type: "daily" | "lifetime" } | null>(null);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/meta/${accountId}/campaigns/${campaignId}/adsets?datePreset=${datePreset}`)
      .then((r) => r.json())
      .then((data) => {
        const list: MetaAdSet[] = Array.isArray(data) ? data : [];
        const score = (a: MetaAdSet) => {
          if (!a.insights || a.insights.spend === 0) return Infinity;
          if (a.insights.conversations > 0 && a.insights.costPerConversation !== null)
            return a.insights.costPerConversation;
          if (a.insights.leads > 0 && a.insights.costPerLead !== null)
            return a.insights.costPerLead;
          return a.insights.cpm;
        };
        setAdsets([...list].sort((a, b) => {
          if (a.status === "ACTIVE" && b.status !== "ACTIVE") return -1;
          if (a.status !== "ACTIVE" && b.status === "ACTIVE") return 1;
          return score(a) - score(b);
        }));
      })
      .finally(() => setLoading(false));
  }, [accountId, campaignId, datePreset]);

  function sortAds(list: MetaAd[]) {
    const score = (ad: MetaAd) => {
      if (!ad.insights || ad.insights.spend === 0) return Infinity;
      if (ad.insights.conversations > 0 && ad.insights.costPerConversation !== null)
        return ad.insights.costPerConversation;
      if (ad.insights.leads > 0 && ad.insights.costPerLead !== null)
        return ad.insights.costPerLead;
      return ad.insights.cpm;
    };
    return [...list].sort((a, b) => {
      if (a.status === "ACTIVE" && b.status !== "ACTIVE") return -1;
      if (a.status !== "ACTIVE" && b.status === "ACTIVE") return 1;
      return score(a) - score(b);
    });
  }

  async function toggleAdset(adsetId: string) {
    if (expandedAdset === adsetId) {
      setExpandedAdset(null);
      return;
    }
    setExpandedAdset(adsetId);
    if (!adsMap[adsetId]) {
      setLoadingAds(adsetId);
      const res = await fetch(
        `/api/meta/${accountId}/campaigns/${campaignId}/adsets/${adsetId}/ads?datePreset=${datePreset}`
      );
      const data = await res.json();
      setAdsMap((prev) => ({
        ...prev,
        [adsetId]: sortAds(Array.isArray(data) ? data : []),
      }));
      setLoadingAds(null);
    }
  }

  return (
    <div className="p-6 lg:p-8 max-w-6xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <Link
          href={backPath}
          className="mb-4 inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 transition"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Voltar para {client.name}
        </Link>
        <h1 className="text-xl font-bold text-slate-900">Conjuntos de anúncios</h1>
      </div>

      {/* Date preset */}
      <div className="mb-6 flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
        {DATE_PRESETS.map((p) => (
          <button
            key={p.value}
            onClick={() => { setDatePreset(p.value); setAdsMap({}); setExpandedAdset(null); }}
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

      {loading ? (
        <div className="py-16 text-center text-sm text-slate-400">Carregando conjuntos...</div>
      ) : (
        <div className="space-y-3">
          {adsets.map((adset) => {
            const cpl = adset.insights?.costPerConversation ?? null;
            const cplBad = cpl !== null && cpl > client.cplTarget;
            const expanded = expandedAdset === adset.id;

            return (
              <div key={adset.id} className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
                {/* Adset row */}
                <div className="flex items-center">
                  {role === "manager" && (
                    <div className="pl-4 pr-1 flex items-center border-r border-slate-100" onClick={(e) => e.stopPropagation()}>
                      <StatusToggle
                        id={adset.id}
                        status={adset.status}
                        onToggled={(s) => setAdsets((prev) =>
                          prev.map((a) => a.id === adset.id ? { ...a, status: s } : a)
                        )}
                      />
                    </div>
                  )}
                  <button
                    onClick={() => toggleAdset(adset.id)}
                    className="flex-1 flex items-center gap-4 px-5 py-4 hover:bg-slate-50 transition text-left min-w-0"
                  >
                    <svg
                      className={clsx("h-4 w-4 text-slate-400 shrink-0 transition-transform", expanded && "rotate-90")}
                      fill="none" viewBox="0 0 24 24" stroke="currentColor"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-slate-800 truncate">{adset.name}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <p className="text-xs text-slate-400">{adset.optimizationGoal}</p>
                        {adset.dailyBudget && (
                          <span className="text-xs text-slate-500 font-medium">· R$ {adset.dailyBudget.toFixed(0)}/dia</span>
                        )}
                      </div>
                    </div>
                    {adset.insights && (() => {
                      const ft = client.funnelType ?? "leads";
                      const steps = getFunnelSteps(adset.insights, ft, client.cplTarget);
                      return (
                        <div className="hidden sm:flex items-center gap-5 text-sm shrink-0">
                          <Metric label="Investido" value={formatCurrency(adset.insights.spend)} />
                          {steps.map((s) => (
                            <Metric
                              key={s.label}
                              label={s.label}
                              value={s.label === "ROAS"
                                ? `${s.value.toFixed(2)}x`
                                : s.isCurrency
                                ? formatCurrency(s.value)
                                : formatNumber(s.value)}
                              highlight={s.highlight}
                            />
                          ))}
                          <Metric label="CTR" value={formatPercent(adset.insights.ctr)} />
                        </div>
                      );
                    })()}
                  </button>
                  {role === "manager" && (
                    <button
                      onClick={() => setBudgetModal({ id: adset.id, name: adset.name, current: adset.dailyBudget, type: "daily" })}
                      title="Editar orçamento"
                      className="px-4 py-4 text-slate-400 hover:text-blue-600 hover:bg-blue-50 transition shrink-0 border-l border-slate-100"
                    >
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                    </button>
                  )}
                </div>

                {/* Ads */}
                {expanded && (
                  <div className="border-t border-slate-100 bg-slate-50 p-4">
                    {loadingAds === adset.id ? (
                      <p className="text-center text-sm text-slate-400 py-4">Carregando anúncios...</p>
                    ) : (
                      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                        {(adsMap[adset.id] || []).map((ad) => (
                          <AdCard
                            key={ad.id} ad={ad} cplTarget={client.cplTarget}
                            funnelType={client.funnelType ?? "leads"}
                            onOpen={setLightbox}
                            role={role}
                            onStatusChange={(id, s) => setAdsMap((prev) => ({
                              ...prev,
                              [adset.id]: (prev[adset.id] || []).map((a) => a.id === id ? { ...a, status: s } : a),
                            }))}
                          />
                        ))}
                        {(adsMap[adset.id] || []).length === 0 && (
                          <p className="col-span-full text-center text-sm text-slate-400 py-4">
                            Nenhum anúncio encontrado
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}

          {adsets.length === 0 && (
            <div className="py-16 text-center text-sm text-slate-400">
              Nenhum conjunto de anúncios
            </div>
          )}
        </div>
      )}
      {lightbox && (
        <AdLightbox ad={lightbox} cplTarget={client.cplTarget} onClose={() => setLightbox(null)} />
      )}
      {budgetModal && (
        <BudgetModal
          id={budgetModal.id}
          name={budgetModal.name}
          current={budgetModal.current}
          type={budgetModal.type}
          onClose={() => setBudgetModal(null)}
          onSaved={(newBudget) => {
            setAdsets((prev) =>
              prev.map((a) =>
                a.id === budgetModal.id ? { ...a, dailyBudget: newBudget } : a
              )
            );
            setBudgetModal(null);
          }}
        />
      )}
    </div>
  );
}

function AdCard({ ad, cplTarget, funnelType = "leads", onOpen, role, onStatusChange }: {
  ad: MetaAd; cplTarget: number; funnelType?: FunnelType; onOpen: (ad: MetaAd) => void;
  role: "manager" | "client";
  onStatusChange: (id: string, status: "ACTIVE" | "PAUSED") => void;
}) {
  const result = getPrimaryResult(ad.insights ?? null, funnelType);
  const steps = getFunnelSteps(ad.insights ?? null, funnelType, cplTarget);
  const costBad = result.cost !== null && result.cost > cplTarget;
  const isVideo = !!ad.creative?.videoId;
  const [hiResThumb, setHiResThumb] = useState<string | null>(null);

  const igMediaId = ad.creative?.igMediaId;

  useEffect(() => {
    if (!igMediaId) return;
    // Para ads com IG media, buscar a URL de alta res imediatamente
    // (thumbnail_url do fbcdn para vídeos expira; IG media_url é estável)
    fetch(`/api/meta/ig/${igMediaId}`)
      .then((r) => r.json())
      .then((d) => { if (d.url) setHiResThumb(d.url); })
      .catch(() => {});
  }, [igMediaId]);

  // Se tem igMediaId: espera IG media_url (evita URL expirada do fbcdn)
  // Se não tem: usa thumbnail diretamente
  const thumb = igMediaId
    ? (hiResThumb || null)
    : (ad.creative?.thumbnailUrl || ad.creative?.imageUrl || null);

  return (
    <div className="rounded-lg border border-slate-200 bg-white overflow-hidden shadow-sm">
      {/* Toggle + nome */}
      <div className="flex items-center gap-2 px-3 pt-2.5 pb-1">
        {role === "manager" && (
          <StatusToggle
            id={ad.id}
            status={ad.status}
            onToggled={(s) => onStatusChange(ad.id, s)}
          />
        )}
        <p className="text-xs font-medium text-slate-700 line-clamp-1 flex-1">{ad.name}</p>
      </div>
      {/* Creative preview — clicável */}
      <button
        onClick={() => onOpen(ad)}
        className="relative w-full aspect-square bg-slate-100 flex items-center justify-center group overflow-hidden"
      >
        {thumb ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={thumb} alt={ad.name} className="absolute inset-0 w-full h-full object-cover transition group-hover:scale-105" />
        ) : (
          <div className="text-slate-300">
            {igMediaId && !hiResThumb ? (
              <div className="h-3 w-3 rounded-full border-2 border-slate-300 border-t-slate-500 animate-spin" />
            ) : (
              <svg className="h-10 w-10" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
            )}
          </div>
        )}
        {/* Overlay de play/zoom */}
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition flex items-center justify-center">
          <div className="opacity-0 group-hover:opacity-100 transition rounded-full bg-white/90 p-2.5 shadow">
            {isVideo ? (
              <svg className="h-5 w-5 text-slate-800" fill="currentColor" viewBox="0 0 24 24">
                <path d="M8 5v14l11-7z" />
              </svg>
            ) : (
              <svg className="h-5 w-5 text-slate-800" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v3m0 0v3m0-3h3m-3 0H7" />
              </svg>
            )}
          </div>
        </div>
        <span className={clsx("absolute top-2 right-2 rounded-full px-2 py-0.5 text-xs font-medium", ad.status === "ACTIVE" ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-500")}>
          {ad.status === "ACTIVE" ? "Ativo" : "Pausado"}
        </span>
        {isVideo && (
          <span className="absolute top-2 left-2 rounded-full bg-slate-900/70 px-2 py-0.5 text-xs text-white">VID</span>
        )}
      </button>

      {/* Info */}
      <div className="p-3 pt-1">
        {ad.insights ? (
          <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
            <div>
              <span className="text-slate-400">Investido</span>
              <p className="font-semibold text-slate-800">{formatCurrency(ad.insights.spend)}</p>
            </div>
            <div>
              <span className="text-slate-400">CTR</span>
              <p className="font-semibold text-slate-800">{formatPercent(ad.insights.ctr)}</p>
            </div>
            <div>
              <span className="text-slate-400">Alcance</span>
              <p className="font-semibold text-slate-800">{formatNumber(ad.insights.reach)}</p>
            </div>
            <div>
              <span className="text-slate-400">Freq.</span>
              <p className="font-semibold text-slate-800">{ad.insights.frequency.toFixed(2)}</p>
            </div>
            {steps.filter(s => s.value !== 0 || s.label === "Compras").map((step) => (
              <div key={step.label}>
                <span className="text-slate-400">{step.label}</span>
                <p className={clsx("font-semibold",
                  step.highlight === "success" ? "text-green-600" :
                  step.highlight === "danger" ? "text-red-600" : "text-slate-800"
                )}>
                  {step.label === "ROAS"
                    ? `${step.value.toFixed(2)}x`
                    : step.isCurrency
                    ? formatCurrency(step.value)
                    : formatNumber(step.value)}
                </p>
                {step.cost !== null && (
                  <p className="text-xs text-slate-400">{formatCurrency(step.cost)}/un.</p>
                )}
              </div>
            ))}
            {ad.insights.videoViews > 0 && (
              <div className="col-span-2">
                <span className="text-slate-400">Views de vídeo</span>
                <p className="font-semibold text-slate-800">{formatNumber(ad.insights.videoViews)}</p>
              </div>
            )}
          </div>
        ) : (
          <p className="text-xs text-slate-400">Sem dados no período</p>
        )}
      </div>
    </div>
  );
}

function Metric({
  label,
  value,
  highlight = "none",
}: {
  label: string;
  value: string;
  highlight?: "success" | "danger" | "none";
}) {
  return (
    <div className="text-right">
      <p className="text-xs text-slate-400">{label}</p>
      <p className={clsx(
        "text-sm font-semibold",
        highlight === "success" ? "text-green-600" : highlight === "danger" ? "text-red-600" : "text-slate-800"
      )}>
        {value}
      </p>
    </div>
  );
}

function AdLightbox({ ad, cplTarget, onClose }: { ad: MetaAd; cplTarget: number; onClose: () => void }) {
  const [videoSrc, setVideoSrc] = useState<string | null>(null);
  const [loadingVideo, setLoadingVideo] = useState(false);
  const isVideo = !!ad.creative?.videoId;
  const imageUrl = ad.creative?.imageUrl || ad.creative?.thumbnailUrl;
  const cpl = ad.insights?.costPerConversation ?? null;
  const cplBad = cpl !== null && cpl > cplTarget;

  useEffect(() => {
    if (!isVideo || !ad.creative?.videoId) return;
    setLoadingVideo(true);
    fetch(`/api/meta/video/${ad.creative.videoId}`)
      .then((r) => r.json())
      .then((d) => setVideoSrc(d.source || null))
      .finally(() => setLoadingVideo(false));
  }, [ad.creative?.videoId, isVideo]);

  // Fecha com ESC
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-2xl rounded-2xl bg-white shadow-2xl overflow-hidden max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <span className={clsx(
              "rounded-full px-2 py-0.5 text-xs font-medium",
              ad.status === "ACTIVE" ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-500"
            )}>
              {ad.status === "ACTIVE" ? "Ativo" : "Pausado"}
            </span>
            {isVideo && <span className="rounded-full bg-blue-100 text-blue-700 px-2 py-0.5 text-xs font-medium">Vídeo</span>}
          </div>
          <button onClick={onClose} className="rounded-full p-1.5 hover:bg-slate-100 transition text-slate-500">
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Creative */}
        <div className="bg-black flex items-center justify-center min-h-48 max-h-[55vh]">
          {isVideo ? (
            loadingVideo ? (
              <div className="text-white/60 text-sm py-12">Carregando vídeo...</div>
            ) : videoSrc ? (
              <video
                src={videoSrc}
                controls
                autoPlay
                className="max-h-[55vh] w-full"
              />
            ) : (
              <div className="text-white/60 text-sm py-12">Vídeo não disponível</div>
            )
          ) : imageUrl ? (
            <img src={imageUrl} alt={ad.name} className="max-h-[55vh] w-auto object-contain" />
          ) : (
            <div className="text-white/60 text-sm py-12">Criativo não disponível</div>
          )}
        </div>

        {/* Info */}
        <div className="overflow-y-auto p-5 space-y-4">
          <p className="font-semibold text-slate-800">{ad.name}</p>

          {(ad.creative?.title || ad.creative?.body) && (
            <div className="rounded-lg bg-slate-50 p-3 space-y-1.5 text-sm">
              {ad.creative.title && <p className="font-semibold text-slate-800">{ad.creative.title}</p>}
              {ad.creative.body && <p className="text-slate-600 whitespace-pre-wrap">{ad.creative.body}</p>}
              {ad.creative.callToAction && (
                <span className="inline-block mt-1 rounded border border-blue-300 bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">
                  {ad.creative.callToAction}
                </span>
              )}
            </div>
          )}

          {ad.insights && (
            <div className="grid grid-cols-3 gap-3 text-xs">
              {[
                { label: "Investido",   value: formatCurrency(ad.insights.spend) },
                { label: "Alcance",     value: formatNumber(ad.insights.reach) },
                { label: "Freq.",       value: ad.insights.frequency.toFixed(2) },
                { label: "CTR",         value: formatPercent(ad.insights.ctr) },
                { label: "CPM",         value: formatCurrency(ad.insights.cpm) },
                { label: "CPC",         value: ad.insights.cpc > 0 ? formatCurrency(ad.insights.cpc) : "—" },
                ...(ad.insights.conversations > 0 ? [
                  { label: "Conversas", value: String(ad.insights.conversations) },
                  { label: "CPL",       value: cpl !== null ? formatCurrency(cpl) : "—", highlight: cplBad },
                ] : []),
                ...(ad.insights.videoViews > 0 ? [
                  { label: "Views",     value: formatNumber(ad.insights.videoViews) },
                ] : []),
              ].map((m) => (
                <div key={m.label} className="rounded-lg bg-slate-50 p-2.5">
                  <p className="text-slate-400">{m.label}</p>
                  <p className={clsx("font-semibold mt-0.5", "highlight" in m && m.highlight ? "text-red-600" : "text-slate-800")}>
                    {m.value}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function BudgetModal({
  id, name, current, type, onClose, onSaved,
}: {
  id: string; name: string; current: number | null; type: "daily" | "lifetime";
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
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ budget, type }),
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
        <h2 className="font-semibold text-slate-900 mb-1">Editar orçamento</h2>
        <p className="text-sm text-slate-500 mb-5 truncate">{name}</p>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">
              Orçamento {type === "daily" ? "diário" : "vitalício"} (R$)
            </label>
            {current && (
              <p className="text-xs text-slate-400 mb-2">Atual: R$ {current.toFixed(2)}</p>
            )}
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-400">R$</span>
              <input
                type="number"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && save()}
                autoFocus
                min="1"
                step="0.01"
                className="w-full rounded-lg border border-slate-200 pl-9 pr-3 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                placeholder="0,00"
              />
            </div>
          </div>

          {error && <p className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-600">{error}</p>}

          <div className="flex gap-3 pt-1">
            <button onClick={onClose} className="flex-1 rounded-lg border border-slate-200 py-2.5 text-sm text-slate-600 hover:bg-slate-50 transition">
              Cancelar
            </button>
            <button onClick={save} disabled={saving} className="flex-1 rounded-lg bg-blue-600 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60 transition">
              {saving ? "Salvando..." : "Salvar"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
