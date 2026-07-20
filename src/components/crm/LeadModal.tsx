"use client";

import { useState, useEffect, useRef } from "react";
import { clsx } from "clsx";
import type { Lead, LeadReminder } from "@/lib/leads";
import type { Funnel } from "@/lib/funnels";
import type { ChatMessage } from "@/lib/conversations";
import { QuickRepliesPicker, QuickRepliesManager, WabaTemplateVariablesPanel } from "@/components/shared/QuickRepliesPopover";
import type { QuickReply } from "@/components/shared/QuickRepliesPopover";
import type { WabaTemplate } from "@/lib/waba-templates";

function withCountryCode(p: string) {
  const d = p.replace(/\D/g, "");
  return d.startsWith("55") ? d : "55" + d;
}

// ── Cache de prefetch (módulo-level, persiste enquanto a página está aberta) ──
type CacheEntry = { messages: ChatMessage[]; fetchedAt: number };
const _convCache = new Map<string, CacheEntry>();
const CACHE_TTL = 30_000; // 30s

export function prefetchConversation(phone: string, clientId: string | null, funnelId?: string | null) {
  const key = `${clientId ?? ""}:${funnelId ?? ""}:${phone}`;
  const cached = _convCache.get(key);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL) return;
  const funnelParam = funnelId ? `&funnelId=${encodeURIComponent(funnelId)}` : "";
  const qs = clientId ? `?clientId=${encodeURIComponent(clientId)}${funnelParam}` : "";
  fetch(`/api/crm/conversations/${phone}${qs}`)
    .then((r) => r.ok ? r.json() : null)
    .then((data) => { if (data) _convCache.set(key, { messages: data.messages ?? [], fetchedAt: Date.now() }); })
    .catch(() => {});
}

const SCORE_COLOR = (s: number) =>
  s >= 8 ? "text-green-700 bg-green-100 border-green-200" :
  s >= 5 ? "text-yellow-700 bg-yellow-100 border-yellow-200" :
           "text-red-700 bg-red-100 border-red-200";

function fmtTime(ts: number) {
  return new Date(ts).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}
const TZ_SP = "America/Sao_Paulo";
function dateSPStr(ts: number) {
  return new Date(ts).toLocaleDateString("sv-SE", { timeZone: TZ_SP });
}
function fmtDate(ts: number) {
  const dStr = dateSPStr(ts);
  const today = new Date().toLocaleDateString("sv-SE", { timeZone: TZ_SP });
  if (dStr === today) return "Hoje";
  const yest = new Date(today + "T12:00:00-03:00");
  yest.setDate(yest.getDate() - 1);
  if (dStr === yest.toLocaleDateString("sv-SE", { timeZone: TZ_SP })) return "Ontem";
  return new Date(ts).toLocaleDateString("pt-BR", { timeZone: TZ_SP, day: "2-digit", month: "2-digit" });
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

type LiveConnection = {
  id: string;
  phone: string;
  type: "meta" | "uazapi" | "wppconnect" | "evolution";
  status: string;
  connected: boolean;
  funnelId: string;
  funnelName: string;
};

const CONN_TYPE_LABEL: Record<LiveConnection["type"], string> = {
  meta: "📱 API Oficial (Meta)",
  wppconnect: "💬 WPPConnect",
  evolution: "🧬 Evolution API",
  uazapi: "📟 UazAPI",
};

function fmtReminderDate(iso: string) {
  return new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function ReminderSection({ lead, onUpdated }: { lead: Lead; onUpdated: (lead: Lead) => void }) {
  const [showAdd, setShowAdd] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newDue, setNewDue] = useState("");
  const [newNote, setNewNote] = useState("");
  const [saving, setSaving] = useState(false);

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const reminders = lead.reminders ?? [];
  const sorted = [...reminders].sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime());

  async function persist(next: LeadReminder[]) {
    setSaving(true);
    const res = await fetch(`/api/crm/leads/${lead.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reminders: next }),
    });
    const updated = await res.json();
    if (res.ok) onUpdated(updated);
    setSaving(false);
  }

  function addReminder() {
    if (!newTitle.trim() || !newDue) return;
    const reminder: LeadReminder = {
      id: crypto.randomUUID(),
      title: newTitle.trim(),
      dueDate: new Date(newDue).toISOString(),
      note: newNote.trim() || undefined,
      createdAt: new Date().toISOString(),
    };
    persist([...reminders, reminder]);
    setNewTitle(""); setNewDue(""); setNewNote(""); setShowAdd(false);
  }

  function toggleDone(id: string) {
    persist(reminders.map((r) => (r.id === id ? { ...r, done: !r.done } : r)));
  }

  function removeReminder(id: string) {
    if (!confirm("Remover este lembrete?")) return;
    persist(reminders.filter((r) => r.id !== id));
  }

  return (
    <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-3 space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-indigo-700 uppercase tracking-wide">🔔 Lembretes</p>
        <button
          onClick={() => setShowAdd((v) => !v)}
          className="text-xs text-indigo-600 hover:text-indigo-800 font-semibold"
        >
          {showAdd ? "Cancelar" : "+ Novo lembrete"}
        </button>
      </div>

      {showAdd && (
        <div className="space-y-2 bg-white rounded-lg border border-indigo-100 p-2.5">
          <input
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder="Título (ex: Ligar de volta)"
            className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm outline-none focus:border-indigo-400"
          />
          <input
            type="datetime-local"
            value={newDue}
            onChange={(e) => setNewDue(e.target.value)}
            className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm outline-none focus:border-indigo-400"
          />
          <textarea
            value={newNote}
            onChange={(e) => setNewNote(e.target.value)}
            placeholder="Observação (opcional)"
            rows={2}
            className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm outline-none focus:border-indigo-400 resize-none"
          />
          <button
            onClick={addReminder}
            disabled={!newTitle.trim() || !newDue || saving}
            className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700 transition disabled:opacity-50"
          >
            Salvar lembrete
          </button>
        </div>
      )}

      {sorted.length === 0 && !showAdd && (
        <p className="text-xs text-slate-400 italic">Nenhum lembrete para este lead.</p>
      )}

      {sorted.length > 0 && (
        <div className="space-y-1.5">
          {sorted.map((r) => {
            const overdue = !r.done && new Date(r.dueDate).getTime() <= now;
            return (
              <div
                key={r.id}
                className={clsx(
                  "flex items-start gap-2 rounded-lg border px-3 py-2 bg-white",
                  r.done ? "border-slate-100 opacity-50" : overdue ? "border-red-200" : "border-indigo-100"
                )}
              >
                <button
                  onClick={() => toggleDone(r.id)}
                  title={r.done ? "Marcar como pendente" : "Marcar como concluído"}
                  className={clsx(
                    "flex h-5 w-5 items-center justify-center rounded-full border text-[10px] font-bold shrink-0 mt-0.5",
                    r.done ? "border-green-300 bg-green-100 text-green-700" : "border-slate-300 text-slate-400 hover:border-indigo-400"
                  )}
                >
                  ✓
                </button>
                <div className="flex-1 min-w-0">
                  <p className={clsx("text-xs text-slate-700", r.done && "line-through")}>{r.title}</p>
                  {r.note && <p className="text-[11px] text-slate-500 line-clamp-2">{r.note}</p>}
                  <p className={clsx("text-[10px] mt-0.5 font-medium", overdue ? "text-red-600" : "text-indigo-600")}>
                    {fmtReminderDate(r.dueDate)}
                  </p>
                </div>
                <button
                  onClick={() => removeReminder(r.id)}
                  title="Excluir lembrete"
                  className="text-slate-300 hover:text-red-500 shrink-0"
                >
                  🗑
                </button>
              </div>
            );
          })}
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

  // Mover para outro funil
  const [allFunnels, setAllFunnels] = useState<Funnel[]>([]);
  const [moveFunnelId, setMoveFunnelId] = useState("");
  const [moveColumnId, setMoveColumnId] = useState("");
  const [moving, setMoving] = useState(false);

  // Chat
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loadingChat, setLoadingChat] = useState(false);
  const [connections, setConnections] = useState<LiveConnection[]>([]);
  const [selectedConnId, setSelectedConnId] = useState<string>("");
  const [msgInput, setMsgInput] = useState("");
  const [sending, setSending] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastMsgCountRef = useRef(0);
  const isAtBottomRef = useRef(true);

  // Quick Replies
  const [quickQuery, setQuickQuery] = useState<string | null>(null); // null = fechado, string = filtro ativo
  const [showQuickManager, setShowQuickManager] = useState(false);
  const [pendingImage, setPendingImage] = useState<string | null>(null); // imagem da resposta rápida
  const [pendingTemplate, setPendingTemplate] = useState<WabaTemplate | null>(null);
  const [sendingTemplate, setSendingTemplate] = useState(false);

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  useEffect(() => {
    const cId = lead.clientId;
    if (!cId) return;
    fetch(`/api/crm/funnels?clientId=${encodeURIComponent(cId)}`)
      .then((r) => r.ok ? r.json() : [])
      .then((data: Funnel[]) => setAllFunnels(data.filter((f) => f.id !== funnel.id)))
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lead.clientId, funnel.id]);

  // Carrega todos os números conectados do cliente (Meta oficial, WPPConnect, UazAPI)
  // para o seletor "responder pelo número" na aba de conversa.
  useEffect(() => {
    const cId = lead.clientId;
    if (!cId) return;
    fetch(`/api/crm/connections?clientId=${encodeURIComponent(cId)}`)
      .then((r) => r.ok ? r.json() : { connections: [] })
      .then((data: { connections: LiveConnection[] }) => setConnections(data.connections ?? []))
      .catch(() => setConnections([]));
  }, [lead.clientId]);

  // Seleciona um número padrão quando ainda não há seleção (ex: lead novo, sem
  // histórico de mensagens que permita o backend resolver automaticamente) —
  // prioriza um número conectado do mesmo funil do lead.
  useEffect(() => {
    if (selectedConnId || connections.length === 0) return;
    const sameFunnel = connections.find((c) => c.funnelId === lead.funnelId && c.connected);
    const anyConnected = connections.find((c) => c.connected);
    const fallback = sameFunnel ?? anyConnected ?? connections[0];
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (fallback) setSelectedConnId(fallback.id);
  }, [connections, lead.funnelId, selectedConnId]);

  async function moveFunnel() {
    if (!moveFunnelId || !moveColumnId) return;
    setMoving(true);
    const res = await fetch(`/api/crm/leads/${lead.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ funnelId: moveFunnelId, status: moveColumnId }),
    });
    const updated = await res.json();
    if (res.ok) { onUpdated(updated); onClose(); }
    setMoving(false);
  }

  async function fetchMessages(silent = false) {
    const cacheKey = `${lead.clientId ?? ""}:${lead.funnelId ?? ""}:${lead.phone}:${selectedConnId}`;
    // Se não é polling silencioso, verifica cache primeiro (hit = sem loading)
    if (!silent) {
      const cached = _convCache.get(cacheKey);
      if (cached && Date.now() - cached.fetchedAt < CACHE_TTL) {
        setMessages(cached.messages);
        return; // sem loading, sem fetch
      }
      setLoadingChat(true);
    }
    try {
      const qsParams = new URLSearchParams();
      if (lead.clientId) qsParams.set("clientId", lead.clientId);
      if (lead.funnelId) qsParams.set("funnelId", lead.funnelId);
      if (selectedConnId) qsParams.set("connId", selectedConnId);
      const qs = qsParams.toString();
      const res = await fetch(`/api/crm/conversations/${lead.phone}${qs ? `?${qs}` : ""}`);
      if (res.ok) {
        const data = await res.json();
        const msgs = data.messages ?? [];
        _convCache.set(cacheKey, { messages: msgs, fetchedAt: Date.now() });
        setMessages(msgs);
        // Sem seleção manual ainda: alinha o seletor com o número que o backend resolveu
        if (!selectedConnId && data.connId) setSelectedConnId(data.connId);
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
  }, [tab, lead.phone, selectedConnId]);

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
    if ((!msgInput.trim() && !pendingImage) || sending) return;
    setSending(true);
    const text = msgInput.trim();
    const img = pendingImage;
    setMsgInput("");
    setPendingImage(null);
    setQuickQuery(null);
    isAtBottomRef.current = true;
    // Optimistic UI: show image preview or text
    const previewContent = img ? (text ? `[imagem] ${text}` : "[imagem]") : text;
    const optimisticTs = Date.now();
    setMessages((prev) => [...prev, { role: "assistant", content: previewContent, ts: optimisticTs }]);
    try {
      const res = await fetch(`/api/crm/conversations/${lead.phone}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text || undefined,
          imageUrl: img || undefined,
          clientId: lead.clientId,
          funnelId: lead.funnelId,
          connId: selectedConnId || undefined,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        // Remove a mensagem otimista — não foi enviada nem salva no histórico
        setMessages((prev) => prev.filter((m) => m.ts !== optimisticTs));
        alert(`Erro ao enviar mensagem: ${data?.error ?? "verifique a conexão"}`);
      }
    } catch {
      setMessages((prev) => prev.filter((m) => m.ts !== optimisticTs));
      alert("Erro ao enviar mensagem. Verifique sua conexão.");
    }
    setSending(false);
  }

  function handleQuickSelect(reply: QuickReply) {
    setMsgInput(reply.text);
    if (reply.imageUrl) setPendingImage(reply.imageUrl);
    setQuickQuery(null);
  }

  function handleTemplateSelect(tpl: WabaTemplate) {
    const hasVars = tpl.components.some((c) => c.text && /\{\{\d+\}\}/.test(c.text));
    setQuickQuery(null);
    if (hasVars) {
      setPendingTemplate(tpl);
    } else {
      sendTemplateMessage(tpl);
    }
  }

  async function sendTemplateMessage(tpl: WabaTemplate, components?: { type: string; parameters: { type: "text"; text: string }[] }[]) {
    if (sendingTemplate || !lead.clientId) return;
    setSendingTemplate(true);
    setPendingTemplate(null);
    isAtBottomRef.current = true;

    const previewText = `📋 ${tpl.components.filter((c) => c.type !== "BUTTONS" && c.text).map((c) => {
      const sendComp = components?.find((sc) => sc.type.toUpperCase() === c.type);
      const params = sendComp?.parameters ?? [];
      return c.text!.replace(/\{\{(\d+)\}\}/g, (m, n) => params[parseInt(n) - 1]?.text ?? m);
    }).join("\n\n")}`;
    const optimisticTs = Date.now();
    setMessages((prev) => [...prev, { role: "assistant", content: previewText, ts: optimisticTs }]);

    try {
      const res = await fetch("/api/whatsapp/inbox/send-template", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          templateId: tpl.id,
          phone: lead.phone,
          clientId: lead.clientId,
          funnelId: lead.funnelId,
          components,
        }),
      });
      const data = await res.json().catch(() => ({ ok: false }));
      if (!res.ok || !data.ok) {
        setMessages((prev) => prev.filter((m) => m.ts !== optimisticTs));
        alert(`Erro ao enviar template: ${data?.error ?? "verifique a configuração da API Oficial"}`);
      }
    } catch {
      setMessages((prev) => prev.filter((m) => m.ts !== optimisticTs));
      alert("Erro ao enviar template. Verifique sua conexão.");
    }

    setSendingTemplate(false);
  }

  function handleMsgInputChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const val = e.target.value;
    setMsgInput(val);
    if (val.startsWith("/")) {
      setQuickQuery(val.slice(1)); // texto após /
    } else {
      setQuickQuery(null);
    }
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="w-full max-w-4xl rounded-2xl bg-white shadow-2xl overflow-hidden flex flex-col"
        style={{ maxHeight: "95vh" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-4 px-6 py-4 border-b border-slate-100 shrink-0 bg-gradient-to-r from-slate-50 to-white">
          {/* Avatar */}
          <div className="w-12 h-12 rounded-full flex items-center justify-center text-lg font-bold text-white shrink-0 shadow-sm"
            style={{ background: "linear-gradient(135deg,#6366f1,#8b5cf6)" }}>
            {(lead.name?.[0] ?? "?").toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            {editing ? (
              <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                className="text-xl font-bold text-slate-900 w-full outline-none border-b-2 border-blue-400 pb-0.5 bg-transparent" />
            ) : (
              <h2 className="text-xl font-bold text-slate-900 truncate">{lead.name}</h2>
            )}
            <div className="flex items-center gap-2 mt-0.5 flex-wrap">
              <span className="text-sm text-slate-500">
                {lead.source === "whatsapp" ? "💬 WhatsApp" : lead.source === "form" ? "📝 Formulário" : "✏️ Manual"}
              </span>
              <span className="text-slate-300">·</span>
              <span className="text-sm text-slate-400">{days === 0 ? "hoje" : `${days} dia${days !== 1 ? "s" : ""} no pipeline`}</span>
              {lead.ai?.score != null && (
                <span className={clsx("rounded-full px-2 py-0.5 text-xs font-bold border", SCORE_COLOR(lead.ai.score))}>
                  IA {lead.ai.score}/10
                </span>
              )}
              <a href={`https://wa.me/${lead.realPhone ?? lead.phone}`} target="_blank" rel="noreferrer"
                className="rounded-full bg-green-100 text-green-700 px-2.5 py-0.5 text-xs font-semibold hover:bg-green-200 transition shrink-0">
                Abrir WA ↗
              </a>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 transition shrink-0 p-1 rounded-lg hover:bg-slate-100">
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-slate-100 shrink-0 bg-white">
          {(["details", "chat"] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)}
              className={clsx("px-8 py-3 text-sm font-semibold transition border-b-2",
                tab === t ? "border-blue-600 text-blue-600" : "border-transparent text-slate-500 hover:text-slate-700")}>
              {t === "details" ? "📋 Detalhes" : "💬 Conversa"}
            </button>
          ))}
        </div>

        {/* Details Tab */}
        {tab === "details" && (
          <div className="overflow-y-auto flex-1">
            <div className="grid grid-cols-5 divide-x divide-slate-100 min-h-full">

              {/* ── Left column (3/5) ── */}
              <div className="col-span-3 p-6 space-y-5">

                {/* Etapa */}
                <div>
                  <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-2">Etapa — {funnel.name}</p>
                  <div className="flex gap-2 flex-wrap">
                    {funnel.columns.map((col) => (
                      <button key={col.id} onClick={() => changeStatus(col.id)}
                        className={clsx("rounded-xl px-4 py-2 text-sm font-semibold transition border",
                          lead.status === col.id ? "text-white border-transparent shadow-sm" : "border-slate-200 text-slate-600 hover:border-slate-300 hover:bg-slate-50")}
                        style={lead.status === col.id ? { backgroundColor: col.color } : undefined}>
                        {col.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Mover para outro funil */}
                {allFunnels.length > 0 && (
                  <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-4">
                    <p className="text-xs font-semibold text-indigo-600 uppercase tracking-widest mb-3">↗ Mover para outro funil</p>
                    <div className="grid grid-cols-2 gap-3 mb-3">
                      <div>
                        <label className="block text-xs text-slate-500 mb-1">Funil de destino</label>
                        <select
                          value={moveFunnelId}
                          onChange={(e) => { setMoveFunnelId(e.target.value); setMoveColumnId(""); }}
                          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm bg-white outline-none focus:border-indigo-400"
                        >
                          <option value="">— Selecione —</option>
                          {allFunnels.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs text-slate-500 mb-1">Etapa de destino</label>
                        <select
                          value={moveColumnId}
                          onChange={(e) => setMoveColumnId(e.target.value)}
                          disabled={!moveFunnelId}
                          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm bg-white outline-none focus:border-indigo-400 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          <option value="">— Selecione —</option>
                          {(allFunnels.find((f) => f.id === moveFunnelId)?.columns ?? []).map((c) => (
                            <option key={c.id} value={c.id}>{c.label}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                    <button
                      onClick={moveFunnel}
                      disabled={!moveFunnelId || !moveColumnId || moving}
                      className="w-full rounded-lg bg-indigo-600 text-white text-sm font-semibold py-2 hover:bg-indigo-700 transition disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {moving ? "Movendo..." : "Mover lead para este funil"}
                    </button>
                  </div>
                )}

                {/* Contato */}
                <div>
                  <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-3">Contato</p>
                  <div className="grid grid-cols-2 gap-x-6 gap-y-4">
                    <div>
                      <p className="text-xs text-slate-400 mb-1">Telefone</p>
                      {editing ? (
                        <div className="space-y-1">
                          {lead.isLid && (
                            <input value={form.realPhone} onChange={(e) => setForm((f) => ({ ...f, realPhone: e.target.value }))}
                              placeholder="Número real (ex: 5544...)"
                              className="w-full rounded-lg border border-blue-300 px-3 py-2 text-sm outline-none focus:border-blue-500" />
                          )}
                          {!lead.isLid && (
                            <input value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-400" />
                          )}
                        </div>
                      ) : (
                        <div>
                          <p className="text-sm font-medium text-slate-800 font-mono">{withCountryCode(lead.realPhone ?? lead.phone)}</p>
                          {lead.isLid && !lead.realPhone && <span className="text-xs text-amber-600">LID — edite para inserir o número real</span>}
                        </div>
                      )}
                    </div>
                    <div>
                      <p className="text-xs text-slate-400 mb-1">E-mail</p>
                      {editing ? (
                        <input value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                          placeholder="email@..." className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-400" />
                      ) : (
                        <p className="text-sm font-medium text-slate-800">{lead.email ?? "—"}</p>
                      )}
                    </div>
                    <div>
                      <p className="text-xs text-slate-400 mb-1">Valor estimado</p>
                      {editing ? (
                        <input value={form.value} onChange={(e) => setForm((f) => ({ ...f, value: e.target.value }))}
                          type="number" placeholder="0,00" className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-400" />
                      ) : (
                        <p className="text-sm font-semibold text-slate-800">
                          {lead.value ? lead.value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) : "—"}
                        </p>
                      )}
                    </div>
                    <div>
                      <p className="text-xs text-slate-400 mb-1">Campanha</p>
                      {editing ? (
                        <input value={form.campaignName} onChange={(e) => setForm((f) => ({ ...f, campaignName: e.target.value }))}
                          placeholder="Nome da campanha" className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-400" />
                      ) : (
                        <p className="text-sm font-medium text-slate-800">{lead.campaignName ?? "—"}</p>
                      )}
                    </div>
                  </div>
                </div>

                {/* UTMs */}
                {(lead.utmSource || lead.utmMedium || lead.utmCampaign || lead.utmContent || lead.utmTerm || lead.fbclid || lead.gclid) && (
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                    <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-3">📊 Rastreamento</p>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-2">
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
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                    <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-3">
                      {lead.adPlatform === "meta" ? "🟦 Meta Ads" : lead.adPlatform === "google" ? "🔴 Google Ads" : "📣 Campanha"}
                    </p>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                      {lead.adPlatform   && <><span className="text-xs text-slate-400">Plataforma</span>  <span className="text-xs font-medium text-slate-700">{lead.adPlatform === "meta" ? "Meta Ads" : lead.adPlatform === "google" ? "Google Ads" : lead.adPlatform}</span></>}
                      {lead.campaignName && <><span className="text-xs text-slate-400">Campanha</span>    <span className="text-xs font-medium text-slate-700 truncate">{lead.campaignName}</span></>}
                      {lead.adSetName    && <><span className="text-xs text-slate-400">Conjunto</span>    <span className="text-xs font-medium text-slate-700 truncate">{lead.adSetName}</span></>}
                      {lead.adName       && <><span className="text-xs text-slate-400">Anúncio</span>     <span className="text-xs font-medium text-slate-700 truncate">{lead.adName}</span></>}
                      {lead.adId         && <><span className="text-xs text-slate-400">Ad ID</span>       <span className="text-xs font-mono text-slate-500 truncate">{lead.adId}</span></>}
                      {lead.campaignId   && <><span className="text-xs text-slate-400">Campaign ID</span> <span className="text-xs font-mono text-slate-500 truncate">{lead.campaignId}</span></>}
                    </div>
                  </div>
                )}

                {/* Campos extras do formulário */}
                {lead.customFields && Object.keys(lead.customFields).length > 0 && (
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                    <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-3">📋 Dados do Formulário</p>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                      {Object.entries(lead.customFields).map(([k, v]) => (
                        <>
                          <span key={k + "_k"} className="text-xs text-slate-400 truncate">{k}</span>
                          <span key={k + "_v"} className="text-xs font-medium text-slate-700 truncate">{v}</span>
                        </>
                      ))}
                    </div>
                  </div>
                )}

                {/* Anotações */}
                <div>
                  <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-2">Anotações</p>
                  <textarea value={editing ? form.notes : lead.notes}
                    onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                    onFocus={() => !editing && setEditing(true)}
                    rows={4} placeholder="Adicione anotações sobre este lead..."
                    className="w-full rounded-xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-blue-400 resize-none" />
                </div>
              </div>

              {/* ── Right column (2/5) ── */}
              <div className="col-span-2 p-6 space-y-5 bg-slate-50/50">

                {/* IA toggle */}
                <div className={clsx(
                  "rounded-xl border p-4",
                  lead.aiPaused ? "border-amber-200 bg-amber-50" : "border-violet-200 bg-violet-50"
                )}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className={clsx("text-xs font-bold uppercase tracking-wide", lead.aiPaused ? "text-amber-700" : "text-violet-700")}>
                        {lead.aiPaused ? "⏸ IA pausada" : "🤖 IA ativa"}
                      </p>
                      <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                        {lead.aiPaused
                          ? "Especialista assumiu. Reative quando quiser."
                          : "Respondendo automaticamente."}
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
                        "rounded-lg px-3 py-1.5 text-xs font-bold transition shrink-0 whitespace-nowrap",
                        lead.aiPaused
                          ? "bg-violet-600 text-white hover:bg-violet-700"
                          : "bg-amber-500 text-white hover:bg-amber-600"
                      )}
                    >
                      {lead.aiPaused ? "Reativar" : "Pausar"}
                    </button>
                  </div>
                </div>

                {/* Follow-up toggle */}
                <div className={clsx(
                  "rounded-xl border p-4",
                  lead.followUpDisabled ? "border-slate-200 bg-slate-50" : "border-emerald-200 bg-emerald-50"
                )}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className={clsx("text-xs font-bold uppercase tracking-wide", lead.followUpDisabled ? "text-slate-500" : "text-emerald-700")}>
                        {lead.followUpDisabled ? "🔕 Follow-up desativado" : "🔔 Follow-up ativo"}
                      </p>
                      <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                        {lead.followUpDisabled
                          ? "Este lead não recebe follow-ups automáticos."
                          : "Segue a sequência configurada normalmente."}
                      </p>
                    </div>
                    <button
                      onClick={async () => {
                        const res = await fetch(`/api/crm/leads/${lead.id}`, {
                          method: "PUT",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ followUpDisabled: !lead.followUpDisabled }),
                        });
                        const updated = await res.json();
                        if (res.ok) { setLead(updated); onUpdated(updated); }
                      }}
                      className={clsx(
                        "rounded-lg px-3 py-1.5 text-xs font-bold transition shrink-0 whitespace-nowrap",
                        lead.followUpDisabled
                          ? "bg-emerald-600 text-white hover:bg-emerald-700"
                          : "bg-slate-500 text-white hover:bg-slate-600"
                      )}
                    >
                      {lead.followUpDisabled ? "Reativar" : "Desativar"}
                    </button>
                  </div>
                </div>

                {/* Análise IA */}
                <div className="rounded-xl border border-purple-200 bg-white p-4">
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-xs font-bold text-purple-700 uppercase tracking-wide">✨ Análise IA</p>
                    <button onClick={analyze} disabled={analyzing} className="text-xs text-purple-600 hover:text-purple-800 font-semibold disabled:opacity-50">
                      {analyzing ? "Analisando..." : lead.ai ? "Reanalisar" : "Analisar"}
                    </button>
                  </div>
                  {lead.ai ? (
                    <div className="space-y-3">
                      <div className="flex items-center gap-3">
                        <span className={clsx("rounded-xl px-3 py-1.5 text-lg font-black border", SCORE_COLOR(lead.ai.score))}>{lead.ai.score}/10</span>
                        <span className="text-sm font-medium text-slate-600">
                          {lead.ai.score >= 8 ? "Alta intenção" : lead.ai.score >= 5 ? "Média intenção" : "Baixa intenção"}
                        </span>
                      </div>
                      <p className="text-sm text-slate-700 leading-relaxed">{lead.ai.summary}</p>
                      <div className="rounded-lg bg-purple-50 border border-purple-100 px-3 py-2.5">
                        <p className="text-xs text-purple-600 font-semibold mb-1">Próximo passo:</p>
                        <p className="text-sm text-slate-700 leading-relaxed">{lead.ai.nextStep}</p>
                      </div>
                    </div>
                  ) : (
                    <p className="text-sm text-slate-400 italic">Clique em "Analisar" para obter insights.</p>
                  )}
                </div>

                {/* Lembretes */}
                <ReminderSection lead={lead} onUpdated={(u) => { setLead(u); onUpdated(u); }} />

                {/* Follow-ups */}
                <FollowUpSection leadId={lead.id} />
              </div>
            </div>
          </div>
        )}

        {/* Chat Tab */}
        {tab === "chat" && (
          <div className="flex flex-col flex-1 min-h-0">
            {/* Seletor de número conectado — separa API Oficial (Meta) de WPPConnect/UazAPI */}
            {connections.length > 0 && (
              <div className="flex items-center gap-2 px-4 py-2 border-b border-slate-100 bg-white shrink-0">
                <span className="text-xs text-slate-400 font-medium shrink-0">Responder pelo número:</span>
                <select
                  value={selectedConnId}
                  onChange={(e) => setSelectedConnId(e.target.value)}
                  className="flex-1 min-w-0 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 outline-none focus:border-green-400"
                >
                  {(["meta", "wppconnect", "evolution", "uazapi"] as const).map((type) => {
                    const group = connections.filter((c) => c.type === type);
                    if (group.length === 0) return null;
                    return (
                      <optgroup key={type} label={CONN_TYPE_LABEL[type]}>
                        {group.map((c) => (
                          <option key={c.id} value={c.id}>
                            {(c.phone || c.id) + (c.connected ? "" : " — desconectado")}
                          </option>
                        ))}
                      </optgroup>
                    );
                  })}
                </select>
              </div>
            )}
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
            <div className="border-t border-slate-200 bg-white shrink-0">
              {/* Pending image preview */}
              {pendingImage && (
                <div className="flex items-center gap-2 px-4 pt-3">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={pendingImage} alt="imagem" className="h-14 w-14 object-cover rounded-lg border border-slate-200" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-slate-500">📎 Foto anexada</p>
                    <p className="text-xs text-slate-400 truncate">{pendingImage}</p>
                  </div>
                  <button onClick={() => setPendingImage(null)} className="text-xs text-red-500 hover:text-red-700 font-medium">✕</button>
                </div>
              )}

              <div className="relative px-4 py-3 flex gap-3 items-end">
                {/* Painel de variáveis do template (sobrepõe o picker) */}
                {pendingTemplate && (
                  <WabaTemplateVariablesPanel
                    template={pendingTemplate}
                    sending={sendingTemplate}
                    onSend={(components) => sendTemplateMessage(pendingTemplate, components)}
                    onCancel={() => setPendingTemplate(null)}
                  />
                )}

                {/* Quick replies picker (shown when query is not null) */}
                {!pendingTemplate && quickQuery !== null && lead.clientId && (
                  <QuickRepliesPicker
                    clientId={lead.clientId}
                    query={quickQuery}
                    onSelect={handleQuickSelect}
                    onSelectTemplate={handleTemplateSelect}
                    onOpenManager={() => { setQuickQuery(null); setShowQuickManager(true); }}
                  />
                )}

                {/* ⚡ Quick replies button */}
                {lead.clientId && (
                  <button
                    onClick={() => setShowQuickManager(true)}
                    title="Respostas rápidas"
                    className="shrink-0 rounded-xl border border-slate-200 px-3 py-2.5 text-base hover:bg-amber-50 hover:border-amber-300 transition"
                  >
                    ⚡
                  </button>
                )}

                <textarea
                  value={msgInput}
                  onChange={handleMsgInputChange}
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMsg(); } }}
                  placeholder="Mensagem... (ou digite / para respostas rápidas)"
                  rows={2}
                  className="flex-1 rounded-xl border border-slate-200 px-4 py-2.5 text-sm outline-none focus:border-green-400 resize-none"
                  style={{ maxHeight: 120 }}
                />
                <button onClick={sendMsg} disabled={sending || (!msgInput.trim() && !pendingImage)}
                  className="shrink-0 rounded-xl bg-green-500 hover:bg-green-600 disabled:opacity-40 px-5 py-2.5 text-white font-bold text-sm transition">
                  {sending ? "..." : "Enviar"}
                </button>
              </div>
            </div>

            {/* Quick Replies Manager modal */}
            {showQuickManager && lead.clientId && (
              <QuickRepliesManager
                clientId={lead.clientId}
                onClose={() => setShowQuickManager(false)}
              />
            )}
          </div>
        )}

        {/* Footer (only on details tab) */}
        {tab === "details" && (
          <div className="flex items-center justify-between border-t border-slate-100 px-6 py-4 shrink-0 bg-white">
            {canDeleteLeads ? (
              <button onClick={remove} className="text-sm text-red-500 hover:text-red-700 font-medium transition">🗑 Remover lead</button>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              {editing && (
                <>
                  <button onClick={() => { setEditing(false); setForm({ name: lead.name, phone: lead.phone, realPhone: lead.realPhone ?? "", email: lead.email ?? "", value: lead.value?.toString() ?? "", notes: lead.notes, campaignName: lead.campaignName ?? "" }); }}
                    className="rounded-xl border border-slate-200 px-5 py-2 text-sm text-slate-600 hover:bg-slate-50 font-medium">
                    Cancelar
                  </button>
                  <button onClick={save} disabled={saving} className="rounded-xl bg-blue-600 px-5 py-2 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-60 transition">
                    {saving ? "Salvando..." : "Salvar alterações"}
                  </button>
                </>
              )}
              {!editing && (
                <button onClick={() => setEditing(true)} className="rounded-xl border border-slate-200 px-5 py-2 text-sm text-slate-600 hover:bg-slate-50 font-medium transition">
                  ✏️ Editar
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
