"use client";

import { useState, useEffect, useRef } from "react";
import { clsx } from "clsx";
import type { Lead } from "@/lib/leads";
import type { Funnel } from "@/lib/funnels";
import type { ChatMessage } from "@/lib/conversations";

const SCORE_COLOR = (s: number) =>
  s >= 8 ? "text-green-700 bg-green-100 border-green-200" :
  s >= 5 ? "text-yellow-700 bg-yellow-100 border-yellow-200" :
           "text-red-700 bg-red-100 border-red-200";

function fmtTime(ts: number) {
  return new Date(ts).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}
function fmtDate(ts: number) {
  const d = new Date(ts);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return "Hoje";
  const yest = new Date(today); yest.setDate(today.getDate() - 1);
  if (d.toDateString() === yest.toDateString()) return "Ontem";
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

type PendingFU = { id: string; scheduledAt: string; message: string; stepIndex?: number };

function FollowUpSection({ leadId }: { leadId: string }) {
  const [items, setItems] = useState<PendingFU[] | null>(null);
  const [cancelling, setCancelling] = useState(false);

  function load() {
    fetch(`/api/crm/leads/${leadId}/followups`)
      .then((r) => r.json())
      .then((data) => setItems(Array.isArray(data) ? data : []))
      .catch(() => setItems([]));
  }

  useEffect(() => { load(); }, [leadId]); // eslint-disable-line react-hooks/exhaustive-deps

  function fmtDate(iso: string) {
    const d = new Date(iso);
    const now = new Date();
    const diff = d.getTime() - now.getTime();
    if (diff < 0) return "vencido";
    const h = Math.floor(diff / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    if (h >= 24) return `em ${Math.floor(h / 24)}d ${h % 24}h`;
    if (h > 0) return `em ${h}h ${m}min`;
    return `em ${m}min`;
  }

  return (
    <div className="rounded-xl border border-orange-200 bg-orange-50 p-3 space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-orange-700 uppercase tracking-wide">
          ⏰ Follow-ups agendados
        </p>
        {items !== null && items.length > 0 && (
          <button
            onClick={async () => {
              setCancelling(true);
              await fetch(`/api/crm/leads/${leadId}/followups`, { method: "DELETE" });
              setCancelling(false);
              setItems([]);
            }}
            disabled={cancelling}
            className="text-xs text-red-600 hover:text-red-800 font-semibold disabled:opacity-50"
          >
            {cancelling ? "Cancelando..." : "Cancelar todos"}
          </button>
        )}
      </div>

      {items === null && <p className="text-xs text-slate-400 animate-pulse">Carregando...</p>}

      {items !== null && items.length === 0 && (
        <p className="text-xs text-slate-400 italic">Nenhum follow-up agendado para este lead.</p>
      )}

      {items !== null && items.length > 0 && (
        <div className="space-y-1.5">
          {items.map((fu, i) => (
            <div key={fu.id} className="flex items-start gap-2 bg-white rounded-lg border border-orange-100 px-3 py-2">
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-orange-200 text-[10px] font-bold text-orange-700 shrink-0 mt-0.5">
                {(fu.stepIndex ?? i) + 1}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-xs text-slate-700 line-clamp-2">{fu.message}</p>
                <p className="text-[10px] text-orange-600 mt-0.5 font-medium">{fmtDate(fu.scheduledAt)}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function LeadModal({
  lead: initial,
  funnel,
  onClose,
  onUpdated,
  onDeleted,
  canDeleteLeads = true,
}: {
  lead: Lead;
  funnel: Funnel;
  onClose: () => void;
  onUpdated: (lead: Lead) => void;
  onDeleted: (id: string) => void;
  canDeleteLeads?: boolean;
}) {
  const [lead, setLead] = useState(initial);
  const [tab, setTab] = useState<"details" | "chat">(initial.source === "whatsapp" ? "chat" : "details");
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ name: initial.name, phone: initial.phone, realPhone: initial.realPhone ?? "", email: initial.email ?? "", value: initial.value?.toString() ?? "", notes: initial.notes, campaignName: initial.campaignName ?? "" });
  const [saving, setSaving] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);

  // Chat
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loadingChat, setLoadingChat] = useState(false);
  const [msgInput, setMsgInput] = useState("");
  const [sending, setSending] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastMsgCountRef = useRef(0);
  const isAtBottomRef = useRef(true);

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  async function fetchMessages(silent = false) {
    if (!silent) setLoadingChat(true);
    try {
      const clientId = lead.clientId ? `?clientId=${encodeURIComponent(lead.clientId)}` : "";
      const res = await fetch(`/api/crm/conversations/${lead.phone}${clientId}`);
      if (res.ok) {
        const data = await res.json();
        setMessages(data.messages ?? []);
      }
    } finally {
      if (!silent) setLoadingChat(false);
    }
  }

  useEffect(() => {
    if (tab === "chat") {
      isAtBottomRef.current = true;
      lastMsgCountRef.current = 0;
      fetchMessages();
      pollRef.current = setInterval(() => fetchMessages(true), 4000);
    }
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, lead.phone]);

  useEffect(() => {
    if (tab !== "chat") return;
    const prevCount = lastMsgCountRef.current;
    const newCount = messages.length;
    lastMsgCountRef.current = newCount;
    if (newCount === 0) return;
    if (prevCount === 0 || (newCount > prevCount && isAtBottomRef.current)) {
      chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, tab]);

  async function sendMsg() {
    if (!msgInput.trim() || sending) return;
    setSending(true);
    const text = msgInput.trim();
    setMsgInput("");
    isAtBottomRef.current = true;
    setMessages((prev) => [...prev, { role: "assistant", content: text, ts: Date.now() }]);
    await fetch(`/api/crm/conversations/${lead.phone}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: text }),
    });
    setSending(false);
  }

  async function save() {
    setSaving(true);
    const res = await fetch(`/api/crm/leads/${lead.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: form.name, phone: form.phone, realPhone: form.realPhone || null, email: form.email || null,
        value: form.value ? Number(form.value) : null, notes: form.notes, campaignName: form.campaignName || null,
      }),
    });
    const updated = await res.json();
    setLead(updated); onUpdated(updated); setEditing(false); setSaving(false);
  }

  async function changeStatus(status: string) {
    const res = await fetch(`/api/crm/leads/${lead.id}`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    const updated = await res.json();
    setLead(updated); onUpdated(updated);
  }

  async function analyze() {
    setAnalyzing(true);
    const res = await fetch(`/api/crm/leads/${lead.id}/analyze`, { method: "POST" });
    const updated = await res.json();
    if (res.ok) { setLead(updated); onUpdated(updated); }
    setAnalyzing(false);
  }

  async function remove() {
    if (!confirm("Remover este lead?")) return;
    await fetch(`/api/crm/leads/${lead.id}`, { method: "DELETE" });
    onDeleted(lead.id);
  }

  const days = Math.floor((Date.now() - new Date(lead.updatedAt ?? lead.createdAt).getTime()) / 86400000);

  // Group messages by day for date separators
  const grouped: { date: string; msgs: ChatMessage[] }[] = [];
  for (const m of messages) {
    const d = fmtDate(m.ts);
    if (!grouped.length || grouped[grouped.length - 1].date !== d) grouped.push({ date: d, msgs: [] });
    grouped[grouped.length - 1].msgs.push(m);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="w-full max-w-lg rounded-2xl bg-white shadow-2xl overflow-hidden flex flex-col"
        style={{ maxHeight: "90vh" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between p-5 border-b border-slate-100 shrink-0">
          <div className="flex-1 min-w-0">
            {editing ? (
              <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                className="text-lg font-bold text-slate-900 w-full outline-none border-b border-blue-400 pb-0.5" />
            ) : (
              <h2 className="text-lg font-bold text-slate-900 truncate">{lead.name}</h2>
            )}
            <p className="text-sm text-slate-500 mt-0.5">
              {lead.source === "whatsapp" ? "💬 WhatsApp" : lead.source === "form" ? "📝 Formulário" : "✏️ Manual"}
              {lead.campaignName && ` · ${lead.campaignName}`}
              {" · "}{days === 0 ? "hoje" : `${days} dia${days !== 1 ? "s" : ""} no pipeline`}
            </p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 ml-3 shrink-0">
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-slate-100 shrink-0">
          {(["details", "chat"] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)}
              className={clsx("flex-1 py-2.5 text-sm font-medium transition",
                tab === t ? "border-b-2 border-blue-600 text-blue-600" : "text-slate-500 hover:text-slate-700")}>
              {t === "details" ? "Detalhes" : "💬 Conversa"}
            </button>
          ))}
        </div>

        {/* Details Tab */}
        {tab === "details" && (
          <div className="p-5 overflow-y-auto flex-1 space-y-4">
            {/* Status */}
            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Etapa — {funnel.name}</p>
              <div className="flex gap-1.5 flex-wrap">
                {funnel.columns.map((col) => (
                  <button key={col.id} onClick={() => changeStatus(col.id)}
                    className={clsx("rounded-lg px-3 py-1.5 text-sm font-medium transition border",
                      lead.status === col.id ? "text-white border-transparent" : "border-slate-200 text-slate-600 hover:border-slate-300 hover:bg-slate-50")}
                    style={lead.status === col.id ? { backgroundColor: col.color } : undefined}>
                    {col.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Follow-ups agendados */}
            <FollowUpSection leadId={lead.id} />

            {/* Toggle IA por conversa */}
            <div className={clsx(
              "rounded-xl border p-3 flex items-center justify-between",
              lead.aiPaused
                ? "border-amber-200 bg-amber-50"
                : "border-violet-200 bg-violet-50"
            )}>
              <div>
                <p className={clsx("text-xs font-semibold uppercase tracking-wide", lead.aiPaused ? "text-amber-700" : "text-violet-700")}>
                  {lead.aiPaused ? "⏸ IA pausada nesta conversa" : "🤖 IA ativa nesta conversa"}
                </p>
                <p className="text-xs text-slate-400 mt-0.5">
                  {lead.aiPaused
                    ? "Especialista assumiu. A IA não vai responder até ser reativada."
                    : "A IA responde automaticamente. Pause para assumir manualmente."}
                </p>
              </div>
              <button
                onClick={async () => {
                  const res = await fetch(`/api/crm/leads/${lead.id}`, {
                    method: "PUT",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ aiPaused: !lead.aiPaused }),
                  });
                  const updated = await res.json();
                  if (res.ok) { setLead(updated); onUpdated(updated); }
                }}
                className={clsx(
                  "rounded-lg px-3 py-1.5 text-xs font-semibold transition shrink-0",
                  lead.aiPaused
                    ? "bg-violet-600 text-white hover:bg-violet-700"
                    : "bg-amber-500 text-white hover:bg-amber-600"
                )}
              >
                {lead.aiPaused ? "Reativar IA" : "Pausar IA"}
              </button>
            </div>

            {/* AI Analysis */}
            <div className="rounded-xl border border-purple-200 bg-purple-50 p-3">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-semibold text-purple-700 uppercase tracking-wide">Análise IA</p>
                <button onClick={analyze} disabled={analyzing} className="text-xs text-purple-600 hover:text-purple-800 font-medium disabled:opacity-50">
                  {analyzing ? "Analisando..." : lead.ai ? "Reanalisar" : "Analisar agora"}
                </button>
              </div>
              {lead.ai ? (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <span className={clsx("rounded-lg border px-2.5 py-1 text-sm font-bold", SCORE_COLOR(lead.ai.score))}>{lead.ai.score}/10</span>
                    <span className="text-xs text-slate-500">
                      {lead.ai.score >= 8 ? "Alta intenção de compra" : lead.ai.score >= 5 ? "Intenção média" : "Baixa intenção"}
                    </span>
                  </div>
                  <p className="text-sm text-slate-700">{lead.ai.summary}</p>
                  <div className="rounded-lg bg-white border border-purple-200 px-3 py-2">
                    <p className="text-xs text-purple-600 font-medium mb-0.5">Próximo passo:</p>
                    <p className="text-sm text-slate-700">{lead.ai.nextStep}</p>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-slate-400 italic">Clique em "Analisar agora" para obter insights sobre este lead.</p>
              )}
            </div>

            {/* Contact info */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Telefone</p>
                {editing ? (
                  <div className="flex flex-col gap-1">
                    {lead.isLid && (
                      <input value={form.realPhone} onChange={(e) => setForm((f) => ({ ...f, realPhone: e.target.value }))}
                        placeholder="Número real (ex: 5544...)"
                        className="w-full rounded-lg border border-blue-300 px-2.5 py-1.5 text-sm outline-none focus:border-blue-500" />
                    )}
                    {!lead.isLid && (
                      <input value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                        className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm outline-none focus:border-blue-400" />
                    )}
                  </div>
                ) : (
                  <div>
                    <a href={`https://wa.me/${lead.realPhone ?? lead.phone}`} target="_blank" rel="noreferrer" className="text-sm text-blue-600 hover:underline font-mono">{lead.realPhone ?? lead.phone}</a>
                    {lead.isLid && !lead.realPhone && <span className="ml-2 text-xs text-amber-600">(LID — edite para inserir o número real)</span>}
                  </div>
                )}
              </div>
              <div>
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">E-mail</p>
                {editing ? (
                  <input value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                    placeholder="email@..." className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm outline-none focus:border-blue-400" />
                ) : (
                  <p className="text-sm text-slate-700">{lead.email ?? "—"}</p>
                )}
              </div>
              <div>
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Valor estimado</p>
                {editing ? (
                  <input value={form.value} onChange={(e) => setForm((f) => ({ ...f, value: e.target.value }))}
                    type="number" placeholder="R$ 0,00" className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm outline-none focus:border-blue-400" />
                ) : (
                  <p className="text-sm text-slate-700 font-medium">
                    {lead.value ? lead.value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) : "—"}
                  </p>
                )}
              </div>
              <div>
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Campanha</p>
                {editing ? (
                  <input value={form.campaignName} onChange={(e) => setForm((f) => ({ ...f, campaignName: e.target.value }))}
                    placeholder="Nome da campanha" className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm outline-none focus:border-blue-400" />
                ) : (
                  <p className="text-sm text-slate-700">{lead.campaignName ?? "—"}</p>
                )}
              </div>
            </div>

            {/* UTMs */}
            {(lead.utmSource || lead.utmMedium || lead.utmCampaign || lead.utmContent || lead.utmTerm || lead.fbclid || lead.gclid) && (
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">📊 Rastreamento</p>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                  {lead.utmSource   && <><span className="text-xs text-slate-400">utm_source</span>   <span className="text-xs font-medium text-slate-700 truncate">{lead.utmSource}</span></>}
                  {lead.utmMedium   && <><span className="text-xs text-slate-400">utm_medium</span>   <span className="text-xs font-medium text-slate-700 truncate">{lead.utmMedium}</span></>}
                  {lead.utmCampaign && <><span className="text-xs text-slate-400">utm_campaign</span> <span className="text-xs font-medium text-slate-700 truncate">{lead.utmCampaign}</span></>}
                  {lead.utmContent  && <><span className="text-xs text-slate-400">utm_content</span>  <span className="text-xs font-medium text-slate-700 truncate">{lead.utmContent}</span></>}
                  {lead.utmTerm     && <><span className="text-xs text-slate-400">utm_term</span>     <span className="text-xs font-medium text-slate-700 truncate">{lead.utmTerm}</span></>}
                  {lead.fbclid      && <><span className="text-xs text-slate-400">fbclid</span>       <span className="text-xs font-mono text-slate-500 truncate">{lead.fbclid.slice(0,20)}…</span></>}
                  {lead.gclid       && <><span className="text-xs text-slate-400">gclid</span>        <span className="text-xs font-mono text-slate-500 truncate">{lead.gclid.slice(0,20)}…</span></>}
                </div>
              </div>
            )}

            {/* Dados da Campanha */}
            {(lead.adPlatform || lead.campaignId || lead.adSetName || lead.adName || lead.adId) && (
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
                  {lead.adPlatform === "meta" ? "🟦 Campanha Meta Ads" : lead.adPlatform === "google" ? "🔴 Campanha Google Ads" : "📣 Dados da Campanha"}
                </p>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                  {lead.adPlatform   && <><span className="text-xs text-slate-400">Plataforma</span>   <span className="text-xs font-medium text-slate-700">{lead.adPlatform === "meta" ? "Meta Ads" : lead.adPlatform === "google" ? "Google Ads" : lead.adPlatform}</span></>}
                  {lead.campaignName && <><span className="text-xs text-slate-400">Campanha</span>      <span className="text-xs font-medium text-slate-700 truncate">{lead.campaignName}</span></>}
                  {lead.adSetName    && <><span className="text-xs text-slate-400">Conjunto</span>      <span className="text-xs font-medium text-slate-700 truncate">{lead.adSetName}</span></>}
                  {lead.adName       && <><span className="text-xs text-slate-400">Anúncio</span>       <span className="text-xs font-medium text-slate-700 truncate">{lead.adName}</span></>}
                  {lead.adId         && <><span className="text-xs text-slate-400">Ad ID</span>         <span className="text-xs font-mono text-slate-500 truncate">{lead.adId}</span></>}
                  {lead.campaignId   && <><span className="text-xs text-slate-400">Campaign ID</span>   <span className="text-xs font-mono text-slate-500 truncate">{lead.campaignId}</span></>}
                </div>
              </div>
            )}

            {/* Campos extras do formulário */}
            {lead.customFields && Object.keys(lead.customFields).length > 0 && (
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">📋 Dados do Formulário</p>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                  {Object.entries(lead.customFields).map(([k, v]) => (
                    <>
                      <span key={k + "_k"} className="text-xs text-slate-400 truncate">{k}</span>
                      <span key={k + "_v"} className="text-xs font-medium text-slate-700 truncate">{v}</span>
                    </>
                  ))}
                </div>
              </div>
            )}

            {/* Notes */}
            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Anotações</p>
              <textarea value={editing ? form.notes : lead.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                onFocus={() => !editing && setEditing(true)}
                rows={3} placeholder="Adicione anotações sobre este lead..."
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-400 resize-none" />
            </div>
          </div>
        )}

        {/* Chat Tab */}
        {tab === "chat" && (
          <div className="flex flex-col flex-1 min-h-0">
            <div
              ref={chatContainerRef}
              onScroll={() => {
                const el = chatContainerRef.current;
                if (!el) return;
                isAtBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 100;
              }}
              className="flex-1 overflow-y-auto p-4 space-y-1"
              style={{ background: "#f0f2f5" }}
            >
              {loadingChat ? (
                <div className="flex items-center justify-center h-full">
                  <div className="flex flex-col items-center gap-2">
                    <div className="w-6 h-6 border-2 border-slate-300 border-t-green-500 rounded-full animate-spin" />
                    <p className="text-xs text-slate-400">Carregando mensagens...</p>
                  </div>
                </div>
              ) : messages.length === 0 ? (
                <div className="flex items-center justify-center h-full">
                  <p className="text-sm text-slate-400 text-center py-8">Nenhuma mensagem ainda.<br/>Inicie a conversa abaixo.</p>
                </div>
              ) : (
                grouped.map(({ date, msgs }) => (
                  <div key={date}>
                    <div className="flex justify-center my-2">
                      <span className="text-xs text-slate-500 bg-white/80 rounded-full px-3 py-0.5 shadow-sm">{date}</span>
                    </div>
                    {msgs.map((m, i) => {
                      const isMe = m.role === "assistant";
                      const prevSameRole = i > 0 && msgs[i - 1].role === m.role;
                      return (
                        <div key={i} className={clsx("flex items-end gap-2 mb-0.5", isMe ? "justify-end" : "justify-start")}>
                          {/* Avatar do cliente (esquerda) */}
                          {!isMe && (
                            <div className={clsx("w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white flex-shrink-0 mb-0.5",
                              prevSameRole ? "opacity-0" : "opacity-100")}
                              style={{ background: "#6366F1" }}>
                              {(lead.name?.[0] ?? "?").toUpperCase()}
                            </div>
                          )}

                          <div className={clsx("flex flex-col max-w-[72%]", isMe ? "items-end" : "items-start")}>
                            {/* Nome apenas na primeira mensagem de cada bloco */}
                            {!isMe && !prevSameRole && (
                              <span className="text-[10px] font-semibold text-indigo-600 mb-0.5 ml-1">{lead.name}</span>
                            )}
                            <div className={clsx("rounded-2xl px-3.5 py-2 text-sm shadow-sm",
                              isMe
                                ? "bg-[#dcf8c6] text-slate-800 rounded-br-none"
                                : "bg-white text-slate-800 rounded-bl-none border border-slate-100")}>
                              {m.type === "audio" && m.mediaUrl ? (
                                <div className="flex flex-col gap-1.5">
                                  <audio
                                    controls
                                    src={m.mediaUrl}
                                    className="h-8 w-52 max-w-full"
                                    preload="metadata"
                                  />
                                  {m.content && !m.content.startsWith("[") && (
                                    <p className="text-xs text-slate-500 italic whitespace-pre-wrap break-words leading-relaxed">{m.content}</p>
                                  )}
                                </div>
                              ) : m.type === "audio" ? (
                                <span className="flex items-center gap-1.5 text-slate-500 italic text-xs">
                                  <svg className="w-3.5 h-3.5 flex-shrink-0" fill="currentColor" viewBox="0 0 24 24"><path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.91-3c-.49 0-.9.36-.98.85C16.52 14.2 14.47 16 12 16s-4.52-1.8-4.93-4.15c-.08-.49-.49-.85-.98-.85-.61 0-1.09.54-1 1.14.49 3 2.89 5.35 5.91 5.78V20c0 .55.45 1 1 1s1-.45 1-1v-2.08c3.02-.43 5.42-2.78 5.91-5.78.1-.6-.39-1.14-1-1.14z"/></svg>
                                  {m.content && !m.content.startsWith("[") ? m.content : "Áudio"}
                                </span>
                              ) : (
                                <p className="whitespace-pre-wrap break-words leading-relaxed">{m.content}</p>
                              )}
                              <p className={clsx("text-[10px] mt-0.5 text-right", isMe ? "text-green-700/50" : "text-slate-400")}>
                                {fmtTime(m.ts)}
                              </p>
                            </div>
                          </div>

                          {/* Espaço avatar lado direito */}
                          {isMe && <div className="w-7 flex-shrink-0" />}
                        </div>
                      );
                    })}
                  </div>
                ))
              )}
              <div ref={chatEndRef} />
            </div>

            {/* Input */}
            <div className="border-t border-slate-200 bg-white p-3 flex gap-2 items-end shrink-0">
              <textarea
                value={msgInput}
                onChange={(e) => setMsgInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMsg(); } }}
                placeholder="Mensagem... (Enter para enviar)"
                rows={1}
                className="flex-1 rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-green-400 resize-none"
                style={{ maxHeight: 100 }}
              />
              <button onClick={sendMsg} disabled={sending || !msgInput.trim()}
                className="shrink-0 rounded-xl bg-green-500 hover:bg-green-600 disabled:opacity-40 px-4 py-2 text-white font-semibold text-sm transition">
                {sending ? "..." : "Enviar"}
              </button>
            </div>
          </div>
        )}

        {/* Footer (only on details tab) */}
        {tab === "details" && (
          <div className="flex items-center justify-between border-t border-slate-100 px-5 py-3 shrink-0">
            {canDeleteLeads ? (
              <button onClick={remove} className="text-sm text-red-500 hover:text-red-700 transition">Remover lead</button>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              {editing && (
                <>
                  <button onClick={() => { setEditing(false); setForm({ name: lead.name, phone: lead.phone, realPhone: lead.realPhone ?? "", email: lead.email ?? "", value: lead.value?.toString() ?? "", notes: lead.notes, campaignName: lead.campaignName ?? "" }); }}
                    className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50">
                    Cancelar
                  </button>
                  <button onClick={save} disabled={saving} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60">
                    {saving ? "Salvando..." : "Salvar"}
                  </button>
                </>
              )}
              {!editing && (
                <button onClick={() => setEditing(true)} className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50">
                  Editar
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
