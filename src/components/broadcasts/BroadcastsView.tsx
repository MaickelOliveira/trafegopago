"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { clsx } from "clsx";
import type { Funnel } from "@/lib/funnels";
import type { EvolutionSession } from "@/lib/evolution-sessions";
import type { Lead } from "@/lib/leads";
import type { Broadcast } from "@/lib/broadcasts";

type Props = {
  clientId: string;
  evolutionConnections: EvolutionSession[];
  funnels: Funnel[];
};

type SubTab = "new" | "history";

const MIN_DELAY = 5;
const RISK_DELAY_THRESHOLD = 20;

export function BroadcastsView({ clientId, evolutionConnections, funnels }: Props) {
  const [subTab, setSubTab] = useState<SubTab>("new");

  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const [connectionId, setConnectionId] = useState(evolutionConnections[0]?.id ?? "");
  const [delaySeconds, setDelaySeconds] = useState(10);

  const [useCrm, setUseCrm] = useState(false);
  const [funnelId, setFunnelId] = useState(funnels[0]?.id ?? "");
  const [columnId, setColumnId] = useState("");
  const [leads, setLeads] = useState<Lead[] | null>(null);

  const [useManual, setUseManual] = useState(false);
  const [manualText, setManualText] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [campaigns, setCampaigns] = useState<Broadcast[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(true);

  const selectedFunnel = funnels.find((f) => f.id === funnelId);

  // Busca leads do CRM só quando o toggle é ativado, pra contagem ao vivo
  useEffect(() => {
    if (!useCrm || leads) return;
    fetch(`/api/crm/leads?clientId=${clientId}`)
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => setLeads(Array.isArray(data) ? data : []))
      .catch(() => setLeads([]));
  }, [useCrm, leads, clientId]);

  const crmMatches = useMemo(() => {
    if (!useCrm || !leads || !funnelId) return [];
    return leads.filter((l) => l.funnelId === funnelId && (!columnId || l.status === columnId));
  }, [useCrm, leads, funnelId, columnId]);

  const manualPhones = useMemo(() => {
    if (!useManual) return [];
    return manualText.split("\n").map((s) => s.trim()).filter(Boolean);
  }, [useManual, manualText]);

  // Estimativa exibida na tela — dedupe aproximado pelos últimos 11 dígitos.
  // O dedupe real e definitivo (toDialablePhone) acontece no backend ao criar.
  const totalEstimate = useMemo(() => {
    const set = new Set<string>();
    for (const l of crmMatches) {
      const raw = (l.realPhone ?? l.phone)?.replace(/\D/g, "");
      if (raw) set.add(raw.slice(-11));
    }
    for (const p of manualPhones) {
      const raw = p.replace(/\D/g, "");
      if (raw.length >= 10) set.add(raw.slice(-11));
    }
    return set.size;
  }, [crmMatches, manualPhones]);

  const alreadyRunningOnConn = campaigns.some((c) => c.status === "running" && c.connectionId === connectionId);

  const fetchCampaigns = useCallback(() => {
    return fetch(`/api/broadcasts?clientId=${clientId}`)
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => setCampaigns(Array.isArray(data) ? data : []));
  }, [clientId]);

  useEffect(() => {
    fetchCampaigns().finally(() => setLoadingHistory(false));
  }, [fetchCampaigns]);

  // Polling só enquanto existir campanha em andamento — mesma cadência do InboxView
  useEffect(() => {
    if (!campaigns.some((c) => c.status === "running")) return;
    const t = setInterval(fetchCampaigns, 3000);
    return () => clearInterval(t);
  }, [campaigns, fetchCampaigns]);

  async function handleCreate() {
    if (submitting) return;
    setCreateError(null);
    if (!name.trim() || !message.trim() || !connectionId) {
      setCreateError("Preencha nome, mensagem e conexão.");
      return;
    }
    if (delaySeconds < MIN_DELAY) {
      setCreateError(`Intervalo mínimo é ${MIN_DELAY}s.`);
      return;
    }
    if (totalEstimate === 0) {
      setCreateError("Selecione ao menos um destinatário (CRM e/ou lista manual).");
      return;
    }
    if (!confirm(`Disparar "${name}" para aproximadamente ${totalEstimate} destinatário(s), com intervalo de ${delaySeconds}s entre envios?`)) return;

    setSubmitting(true);
    try {
      const res = await fetch("/api/broadcasts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId, name, message, connectionId, delaySeconds,
          funnelId: useCrm ? funnelId : undefined,
          columnId: useCrm && columnId ? columnId : undefined,
          manualPhones: useManual ? manualPhones : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setCreateError(data.error ?? "Falha ao criar campanha");
        return;
      }
      setName(""); setMessage(""); setUseCrm(false); setUseManual(false); setManualText(""); setLeads(null);
      await fetchCampaigns();
      setSubTab("history");
    } catch {
      setCreateError("Falha ao criar campanha");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleAction(id: string, action: "pause" | "resume" | "cancel") {
    if (action === "cancel" && !confirm("Cancelar essa campanha? Os envios pendentes não serão disparados.")) return;
    const res = await fetch(`/api/broadcasts/${id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }),
    });
    if (res.ok) fetchCampaigns();
  }

  if (evolutionConnections.length === 0) {
    return (
      <div className="p-6 text-sm text-slate-500 border border-dashed border-slate-300 rounded-xl text-center">
        Nenhuma conexão Evolution encontrada para este cliente. Conecte um número via Evolution (QR code) antes de criar um disparo em massa.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-2 border-b border-slate-200">
        <button onClick={() => setSubTab("new")}
          className={clsx("px-4 py-2 text-sm font-medium border-b-2 -mb-px transition",
            subTab === "new" ? "border-emerald-600 text-emerald-700" : "border-transparent text-slate-500 hover:text-slate-700")}>
          Nova campanha
        </button>
        <button onClick={() => setSubTab("history")}
          className={clsx("px-4 py-2 text-sm font-medium border-b-2 -mb-px transition",
            subTab === "history" ? "border-emerald-600 text-emerald-700" : "border-transparent text-slate-500 hover:text-slate-700")}>
          Histórico {campaigns.length > 0 && `(${campaigns.length})`}
        </button>
      </div>

      {subTab === "new" && (
        <div className="space-y-4 max-w-2xl">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Nome da campanha</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex: Promoção de agosto"
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-emerald-500" />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Mensagem</label>
            <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={5}
              placeholder="Digite a mensagem... use {{nome}} para inserir o primeiro nome do destinatário"
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-emerald-500" />
            <p className="text-xs text-slate-400 mt-1">
              Dica: use <code className="bg-slate-100 px-1 rounded">{"{{nome}}"}</code> para personalizar com o nome de cada pessoa (fica vazio para números da lista manual).
            </p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Conexão (Evolution)</label>
              <select value={connectionId} onChange={(e) => setConnectionId(e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-emerald-500">
                {evolutionConnections.map((c) => (
                  <option key={c.id} value={c.id}>{c.instanceName}</option>
                ))}
              </select>
              {alreadyRunningOnConn && (
                <p className="text-xs text-amber-600 mt-1">⚠️ Já existe uma campanha em andamento nessa conexão — os disparos serão intercalados.</p>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Intervalo entre envios (segundos)</label>
              <input type="number" min={MIN_DELAY} value={delaySeconds}
                onChange={(e) => setDelaySeconds(Math.max(MIN_DELAY, Number(e.target.value) || MIN_DELAY))}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-emerald-500" />
              {delaySeconds < RISK_DELAY_THRESHOLD && (
                <p className="text-xs text-amber-600 mt-1">⚠️ Intervalos curtos aumentam o risco de restrição do número (Evolution não é API oficial). Recomendado: 20-30s ou mais.</p>
              )}
            </div>
          </div>

          <div className="border border-slate-200 rounded-lg p-4 space-y-3">
            <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
              <input type="checkbox" checked={useCrm} onChange={(e) => setUseCrm(e.target.checked)} />
              Incluir leads do CRM
            </label>
            {useCrm && (
              <div className="grid grid-cols-2 gap-3 pl-6">
                <div>
                  <label className="block text-xs text-slate-500 mb-1">Funil</label>
                  <select value={funnelId} onChange={(e) => { setFunnelId(e.target.value); setColumnId(""); }}
                    className="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm">
                    {funnels.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-slate-500 mb-1">Coluna (opcional — todas se vazio)</label>
                  <select value={columnId} onChange={(e) => setColumnId(e.target.value)}
                    className="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm">
                    <option value="">Todas as colunas</option>
                    {selectedFunnel?.columns.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                  </select>
                </div>
                <p className="col-span-2 text-xs text-slate-500">
                  {leads === null ? "Carregando leads..." : `${crmMatches.length} lead(s) encontrado(s)`}
                </p>
              </div>
            )}
          </div>

          <div className="border border-slate-200 rounded-lg p-4 space-y-3">
            <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
              <input type="checkbox" checked={useManual} onChange={(e) => setUseManual(e.target.checked)} />
              Incluir lista manual de números
            </label>
            {useManual && (
              <div className="pl-6 space-y-1">
                <textarea value={manualText} onChange={(e) => setManualText(e.target.value)} rows={4}
                  placeholder={"Um número por linha, ex:\n44999999999\n44988888888"}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm font-mono outline-none focus:border-emerald-500" />
                <p className="text-xs text-slate-500">{manualPhones.length} número(s) na lista</p>
              </div>
            )}
          </div>

          <div className="flex items-center justify-between bg-slate-50 border border-slate-200 rounded-lg px-4 py-3">
            <p className="text-sm text-slate-700">
              Total de destinatários (estimado, sem duplicados): <span className="font-bold">{totalEstimate}</span>
            </p>
            <button onClick={handleCreate} disabled={submitting || totalEstimate === 0}
              className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white font-semibold rounded-lg px-4 py-2 text-sm transition">
              {submitting ? "Iniciando..." : "Iniciar disparo"}
            </button>
          </div>
          {createError && <p className="text-sm text-red-600">{createError}</p>}
        </div>
      )}

      {subTab === "history" && (
        <div className="space-y-3">
          {loadingHistory && campaigns.length === 0 && <p className="text-sm text-slate-400">Carregando...</p>}
          {!loadingHistory && campaigns.length === 0 && <p className="text-sm text-slate-400">Nenhuma campanha ainda.</p>}
          {campaigns.map((c) => {
            const done = c.sentCount + c.failedCount;
            const pct = c.totalCount > 0 ? Math.round((done / c.totalCount) * 100) : 0;
            return (
              <div key={c.id} className="border border-slate-200 rounded-lg p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold text-slate-900 text-sm">{c.name}</p>
                    <p className="text-xs text-slate-500 truncate mt-0.5">{c.message}</p>
                  </div>
                  <span className={clsx("text-[11px] font-bold px-2 py-0.5 rounded-full shrink-0", {
                    "bg-emerald-100 text-emerald-700": c.status === "running",
                    "bg-amber-100 text-amber-700": c.status === "paused",
                    "bg-slate-100 text-slate-600": c.status === "completed",
                    "bg-red-100 text-red-700": c.status === "cancelled",
                  })}>
                    {c.status === "running" ? "Em andamento" : c.status === "paused" ? "Pausada" : c.status === "completed" ? "Concluída" : "Cancelada"}
                  </span>
                </div>
                <div className="mt-3">
                  <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                    <div className="h-full bg-emerald-500 transition-all" style={{ width: `${pct}%` }} />
                  </div>
                  <p className="text-xs text-slate-500 mt-1">{done}/{c.totalCount} processados — {c.sentCount} enviados, {c.failedCount} falharam</p>
                </div>
                {(c.status === "running" || c.status === "paused") && (
                  <div className="flex gap-2 mt-3">
                    {c.status === "running" && (
                      <button onClick={() => handleAction(c.id, "pause")} className="text-xs font-medium border border-slate-300 rounded-lg px-3 py-1.5 hover:bg-slate-50 transition">Pausar</button>
                    )}
                    {c.status === "paused" && (
                      <button onClick={() => handleAction(c.id, "resume")} className="text-xs font-medium border border-slate-300 rounded-lg px-3 py-1.5 hover:bg-slate-50 transition">Retomar</button>
                    )}
                    <button onClick={() => handleAction(c.id, "cancel")} className="text-xs font-medium border border-red-200 text-red-600 rounded-lg px-3 py-1.5 hover:bg-red-50 transition">Cancelar</button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
