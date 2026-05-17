"use client";

import { useEffect, useState } from "react";
import { clsx } from "clsx";
import type { Creative } from "@/lib/creatives";

interface Campaign { id: string; name: string; status: string; }
interface AdSet    { id: string; name: string; status: string; }

interface Props {
  creative: Creative;
  onClose: () => void;
  onPublished: () => void;
}

export function PublishModal({ creative, onClose, onPublished }: Props) {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [adsets, setAdsets]       = useState<AdSet[]>([]);
  const [campaignId, setCampaignId] = useState("");
  const [adsetId, setAdsetId]       = useState("");
  const [adName, setAdName]         = useState(creative.copy.headline || "Anúncio");
  const [publishStatus, setPublishStatus] = useState<"ACTIVE" | "PAUSED">("PAUSED");
  const [loadingCampaigns, setLoadingCampaigns] = useState(true);
  const [loadingAdsets, setLoadingAdsets]       = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState("");

  useEffect(() => {
    fetch(`/api/meta/${creative.adAccountId}/campaigns?datePreset=today`)
      .then((r) => r.json())
      .then((d) => {
        const active = Array.isArray(d) ? d.filter((c: Campaign) => c.status === "ACTIVE") : [];
        setCampaigns(active);
      })
      .finally(() => setLoadingCampaigns(false));
  }, [creative.adAccountId]);

  useEffect(() => {
    if (!campaignId) { setAdsets([]); setAdsetId(""); return; }
    setLoadingAdsets(true);
    fetch(`/api/meta/${creative.adAccountId}/campaigns/${campaignId}/adsets?datePreset=today`)
      .then((r) => r.json())
      .then((d) => {
        setAdsets(Array.isArray(d) ? d : []);
        setAdsetId("");
      })
      .finally(() => setLoadingAdsets(false));
  }, [campaignId, creative.adAccountId]);

  async function publish() {
    if (!adsetId) { setError("Selecione um conjunto de anúncios"); return; }
    setSaving(true); setError("");
    try {
      const res = await fetch(`/api/creatives/${creative.id}/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adsetId, adName, publishStatus }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Erro ao publicar"); return; }
      onPublished();
    } catch { setError("Erro de conexão"); }
    finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h2 className="font-semibold text-slate-900">Publicar no Meta Ads</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/>
            </svg>
          </button>
        </div>

        <div className="p-6 space-y-4">
          {/* Preview do criativo */}
          <div className="rounded-lg bg-slate-50 border border-slate-200 p-3 text-sm">
            <p className="font-semibold text-slate-800">{creative.copy.headline || "—"}</p>
            {creative.copy.body && <p className="text-slate-500 mt-0.5 line-clamp-2">{creative.copy.body}</p>}
            <p className="text-xs text-slate-400 mt-1">{creative.copy.cta}</p>
          </div>

          {/* Campanha */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">Campanha</label>
            {loadingCampaigns ? (
              <div className="text-sm text-slate-400 py-2">Carregando campanhas...</div>
            ) : (
              <select
                value={campaignId} onChange={(e) => setCampaignId(e.target.value)}
                className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-blue-500"
              >
                <option value="">Selecione uma campanha</option>
                {campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            )}
          </div>

          {/* Conjunto */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">Conjunto de anúncios</label>
            {loadingAdsets ? (
              <div className="text-sm text-slate-400 py-2">Carregando conjuntos...</div>
            ) : (
              <select
                value={adsetId} onChange={(e) => setAdsetId(e.target.value)}
                disabled={!campaignId}
                className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-blue-500 disabled:opacity-50"
              >
                <option value="">Selecione um conjunto</option>
                {adsets.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            )}
          </div>

          {/* Nome do anúncio */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">Nome do anúncio</label>
            <input
              value={adName} onChange={(e) => setAdName(e.target.value)}
              className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            />
          </div>

          {/* Status de publicação */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">Publicar como</label>
            <div className="flex gap-2">
              {(["PAUSED", "ACTIVE"] as const).map((s) => (
                <button
                  key={s} onClick={() => setPublishStatus(s)}
                  className={clsx(
                    "flex-1 rounded-lg border py-2 text-sm font-medium transition",
                    publishStatus === s
                      ? s === "ACTIVE" ? "border-green-500 bg-green-50 text-green-700" : "border-slate-400 bg-slate-100 text-slate-700"
                      : "border-slate-200 text-slate-500 hover:border-slate-300"
                  )}
                >
                  {s === "PAUSED" ? "⏸ Pausado" : "▶ Ativo"}
                </button>
              ))}
            </div>
          </div>

          {error && <p className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-600">{error}</p>}

          <div className="flex gap-3 pt-1">
            <button onClick={onClose} className="flex-1 rounded-lg border border-slate-200 py-2.5 text-sm text-slate-600 hover:bg-slate-50 transition">
              Cancelar
            </button>
            <button onClick={publish} disabled={saving || !adsetId} className="flex-1 rounded-lg bg-blue-600 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60 transition">
              {saving ? "Publicando..." : "Publicar anúncio"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
