"use client";

import { useState, useEffect, useCallback } from "react";
import { clsx } from "clsx";

type ConnectionMetrics = {
  id: string;
  phone: string;
  type: "meta" | "uazapi" | "wppconnect";
  status: string;
  connected: boolean;
  funnelId: string;
  funnelName: string;
  conversationCount: number;
  messageCount: number;
  leadsTotal: number;
  leadsNeedingHuman: number;
  resolutionRate: number | null;
};

type ClientGroup = { clientId: string; clientName: string; connections: ConnectionMetrics[] };

type Props = {
  fetchUrl: string;
  mode?: "single-client" | "all-clients";
};

const TYPE_LABEL: Record<ConnectionMetrics["type"], string> = {
  meta: "Meta API",
  uazapi: "WhatsApp",
  wppconnect: "WhatsApp",
};

function formatPhone(phone: string) {
  const d = phone.replace(/\D/g, "");
  if (d.length === 13) return `+${d.slice(0, 2)} (${d.slice(2, 4)}) ${d.slice(4, 9)}-${d.slice(9)}`;
  if (d.length === 12) return `+${d.slice(0, 2)} (${d.slice(2, 4)}) ${d.slice(4, 8)}-${d.slice(8)}`;
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  return phone || "—";
}

function StatusDot({ connected }: { connected: boolean }) {
  return (
    <span className="relative flex h-2.5 w-2.5">
      {connected && <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75 animate-ping" />}
      <span className={clsx("relative inline-flex h-2.5 w-2.5 rounded-full", connected ? "bg-emerald-500" : "bg-slate-400")} />
    </span>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-2xl font-black text-white tracking-tight">{value}</p>
      <p className="text-[11px] font-semibold text-white/60 uppercase tracking-wide mt-0.5">{label}</p>
    </div>
  );
}

function ConnectionCard({ conn }: { conn: ConnectionMetrics }) {
  const rate = conn.resolutionRate;
  const rateLabel = rate == null ? "—" : `${Math.round(rate * 100)}%`;
  const urgent = conn.leadsNeedingHuman > 0;
  const urgentTone = rate != null && rate < 0.7 ? "bg-red-500" : "bg-amber-500";

  return (
    <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-slate-800 to-slate-900 p-5 shadow-lg">
      <div className="absolute -right-4 -top-4 h-24 w-24 rounded-full bg-white/5" />
      <div className="absolute -right-1 -bottom-6 h-20 w-20 rounded-full bg-white/[0.03]" />
      <div className="relative space-y-4">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <StatusDot connected={conn.connected} />
            <p className="text-sm font-bold text-white truncate">{formatPhone(conn.phone)}</p>
          </div>
          <span className="text-[10px] font-semibold text-white/50 uppercase tracking-wide shrink-0">
            {TYPE_LABEL[conn.type]}
          </span>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <Stat label="Conversas (7d)" value={String(conn.conversationCount)} />
          <Stat label="Mensagens (7d)" value={String(conn.messageCount)} />
          <Stat label="Resolução IA" value={rateLabel} />
        </div>

        {urgent && (
          <div className={clsx("rounded-lg px-3 py-1.5 text-xs font-semibold text-white", urgentTone)}>
            ⚠️ {conn.leadsNeedingHuman} {conn.leadsNeedingHuman === 1 ? "precisa" : "precisam"} de você
          </div>
        )}
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-6 text-center">
      <p className="text-sm text-slate-400">Nenhuma conexão WhatsApp configurada ainda.</p>
    </div>
  );
}

export function ConnectionDashboard({ fetchUrl, mode = "single-client" }: Props) {
  const [connections, setConnections] = useState<ConnectionMetrics[] | null>(null);
  const [clientGroups, setClientGroups] = useState<ClientGroup[] | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(fetchUrl);
      if (!res.ok) return;
      const data = await res.json();
      if (mode === "all-clients") setClientGroups(data.clients ?? []);
      else setConnections(data.connections ?? []);
    } catch { /* mantém último estado conhecido em caso de falha de rede */ }
  }, [fetchUrl, mode]);

  useEffect(() => {
    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, [load]);

  if (mode === "all-clients") {
    if (clientGroups === null) return null;
    const withConnections = clientGroups.filter((g) => g.connections.length > 0);
    if (withConnections.length === 0) return <EmptyState />;
    return (
      <div className="space-y-6">
        {withConnections.map((g) => (
          <div key={g.clientId} className="space-y-3">
            <p className="text-xs font-bold text-slate-500 uppercase tracking-wide">{g.clientName}</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {g.connections.map((c) => <ConnectionCard key={c.id} conn={c} />)}
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (connections === null) return null;
  if (connections.length === 0) return <EmptyState />;
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
      {connections.map((c) => <ConnectionCard key={c.id} conn={c} />)}
    </div>
  );
}
