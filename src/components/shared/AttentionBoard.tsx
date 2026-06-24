"use client";

import { useState } from "react";
import { clsx } from "clsx";
import type { Lead } from "@/lib/leads";

const TERMINAL_STATUSES = ["ganho", "perdido"];

type ClientOption = { id: string; name: string };

type Props = {
  initialLeads: Lead[];
  /** Quando informado, mostra o nome do cliente em cada card (visão global, multi-cliente) */
  clients?: ClientOption[];
};

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diffMs / 60000);
  if (min < 1) return "agora";
  if (min < 60) return `há ${min}min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h}h`;
  return `há ${Math.floor(h / 24)}d`;
}

function AttentionCard({
  lead,
  clientName,
  tone,
  reason,
  detail,
  actionLabel,
  onAction,
}: {
  lead: Lead;
  clientName?: string;
  tone: "red" | "amber";
  reason: string;
  detail?: string;
  actionLabel: string;
  onAction: () => Promise<void>;
}) {
  const [loading, setLoading] = useState(false);
  const waLink = `https://wa.me/${(lead.realPhone ?? lead.phone).replace(/\D/g, "")}`;

  return (
    <div
      className={clsx(
        "rounded-xl border p-3 space-y-2",
        tone === "red" ? "border-red-200 bg-red-50" : "border-amber-200 bg-amber-50"
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          {clientName && <p className="text-[10px] font-semibold text-slate-400 uppercase truncate">{clientName}</p>}
          <p className="text-sm font-semibold text-slate-800 truncate">{lead.name}</p>
          <a href={waLink} target="_blank" rel="noreferrer" className="text-xs text-blue-600 hover:underline">
            {lead.phone}
          </a>
        </div>
        <span className={clsx("text-[10px] font-bold uppercase tracking-wide shrink-0", tone === "red" ? "text-red-600" : "text-amber-600")}>
          {tone === "red" ? "🔥 Urgente" : "⚡ Quente"}
        </span>
      </div>

      <p className="text-xs text-slate-600 line-clamp-3">{reason}</p>
      {detail && <p className="text-[11px] text-slate-400">{detail}</p>}

      <button
        onClick={async () => { setLoading(true); await onAction(); setLoading(false); }}
        disabled={loading}
        className={clsx(
          "w-full rounded-lg px-3 py-1.5 text-xs font-semibold transition disabled:opacity-50",
          tone === "red" ? "bg-red-600 text-white hover:bg-red-700" : "bg-amber-600 text-white hover:bg-amber-700"
        )}
      >
        {loading ? "..." : actionLabel}
      </button>
    </div>
  );
}

export function AttentionBoard({ initialLeads, clients }: Props) {
  const [leads, setLeads] = useState(initialLeads);

  async function patchLead(id: string, patch: Record<string, unknown>) {
    const res = await fetch(`/api/crm/leads/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    const updated = await res.json();
    if (res.ok) setLeads((prev) => prev.map((l) => (l.id === updated.id ? updated : l)));
  }

  const escalated = leads.filter((l) => l.needsAttention && !TERMINAL_STATUSES.includes(l.status));
  const hot = leads.filter(
    (l) => !l.needsAttention && !l.aiPaused && (l.ai?.score ?? 0) >= 8 && !TERMINAL_STATUSES.includes(l.status)
  );

  if (escalated.length === 0 && hot.length === 0) {
    return (
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-center">
        <p className="text-sm text-emerald-700 font-medium">
          Nenhuma conversa precisa de atenção agora — a IA está cuidando de tudo. 🎉
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm font-bold text-slate-800">🔥 Atendimento que precisa de você</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {escalated.map((lead) => (
          <AttentionCard
            key={lead.id}
            lead={lead}
            clientName={clients?.find((c) => c.id === lead.clientId)?.name}
            tone="red"
            reason={lead.needsAttentionReason ?? "A IA pediu ajuda nesta conversa."}
            detail={lead.needsAttentionAt ? timeAgo(lead.needsAttentionAt) : undefined}
            actionLabel="Marcar como resolvido"
            onAction={() => patchLead(lead.id, { needsAttention: false })}
          />
        ))}
        {hot.map((lead) => (
          <AttentionCard
            key={lead.id}
            lead={lead}
            clientName={clients?.find((c) => c.id === lead.clientId)?.name}
            tone="amber"
            reason={`Alta intenção (score ${lead.ai?.score}/10) sem fechamento ainda.`}
            actionLabel="Assumir conversa"
            onAction={() => patchLead(lead.id, { aiPaused: true })}
          />
        ))}
      </div>
    </div>
  );
}
