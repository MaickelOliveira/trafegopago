"use client";

import { useState, useRef, useEffect } from "react";
import { clsx } from "clsx";
import { LeadModal } from "./LeadModal";
import type { Lead } from "@/lib/leads";
import type { Funnel, FunnelColumn } from "@/lib/funnels";

type ClientOption = { id: string; name: string; color: string };

const SCORE_COLOR = (s: number) =>
  s >= 8 ? "text-green-700 bg-green-100" :
  s >= 5 ? "text-yellow-700 bg-yellow-100" :
           "text-red-700 bg-red-100";

const SOURCE_ICON: Record<string, string> = {
  whatsapp: "💬", form: "📝", manual: "✏️",
};

function daysSince(iso: string) {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
}

function fmt(v: number) {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function hexToLight(hex: string): string {
  return hex + "22";
}

// ── Gestão de Funis ──────────────────────────────────────────────────────────
const COL_COLORS = ["#3B82F6","#F59E0B","#F97316","#10B981","#8B5CF6","#EC4899","#94A3B8","#EF4444","#14B8A6","#6366F1"];

function FunnelManager({ funnels, onUpdated, clientId }: { funnels: Funnel[]; onUpdated: (f: Funnel[]) => void; clientId?: string }) {
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<Funnel | null>(null);
  const [editCols, setEditCols] = useState<FunnelColumn[]>([]);
  const [newColName, setNewColName] = useState("");
  const [newColColor, setNewColColor] = useState(COL_COLORS[0]);

  async function create() {
    if (!newName.trim()) return;
    setSaving(true);
    const res = await fetch("/api/crm/funnels", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newName, clientId: clientId ?? null }),
    });
    const created = await res.json();
    onUpdated([...funnels, created]);
    setNewName(""); setCreating(false); setSaving(false);
  }

  async function remove(id: string) {
    if (!confirm("Deletar este funil? Os leads serão mantidos.")) return;
    await fetch(`/api/crm/funnels/${id}`, { method: "DELETE" });
    onUpdated(funnels.filter((f) => f.id !== id));
  }

  function startEdit(f: Funnel) {
    setEditing(f);
    setEditCols(f.columns.map((c) => ({ ...c })));
    setNewColName("");
    setNewColColor(COL_COLORS[0]);
  }

  function addCol() {
    if (!newColName.trim()) return;
    const id = newColName.trim().toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "") + "-" + Date.now();
    setEditCols([...editCols, { id, label: newColName.trim(), color: newColColor }]);
    setNewColName(""); setNewColColor(COL_COLORS[0]);
  }

  function removeCol(idx: number) {
    setEditCols(editCols.filter((_, i) => i !== idx));
  }

  function moveCol(idx: number, dir: -1 | 1) {
    const next = [...editCols];
    const target = idx + dir;
    if (target < 0 || target >= next.length) return;
    [next[idx], next[target]] = [next[target], next[idx]];
    setEditCols(next);
  }

  async function saveEdit() {
    if (!editing || editCols.length === 0) return;
    setSaving(true);
    const res = await fetch(`/api/crm/funnels/${editing.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ columns: editCols }),
    });
    const updated = await res.json();
    onUpdated(funnels.map((f) => f.id === updated.id ? updated : f));
    setEditing(null); setSaving(false);
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 mb-4">
      <div className="flex items-center justify-between mb-3">
        <p className="text-sm font-semibold text-slate-700">Funis</p>
        <button onClick={() => setCreating(true)} className="text-xs text-blue-600 hover:underline font-medium">+ Novo funil</button>
      </div>

      <div className="flex flex-wrap gap-2">
        {funnels.map((f) => (
          <div key={f.id} className="group flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm">
            <span className="font-medium text-slate-700">{f.name}</span>
            <span className="text-xs text-slate-400">{f.columns.length} colunas</span>
            <button onClick={() => startEdit(f)} className="ml-1 text-slate-300 hover:text-blue-500 transition text-xs" title="Editar colunas">✎</button>
            {f.id !== "default" && (
              <button onClick={() => remove(f.id)} className="text-slate-300 hover:text-red-500 transition text-xs" title="Excluir funil">✕</button>
            )}
          </div>
        ))}
      </div>

      {creating && (
        <div className="mt-3 flex gap-2">
          <input autoFocus value={newName} onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && create()} placeholder="Nome do funil"
            className="flex-1 rounded-lg border border-slate-200 px-3 py-1.5 text-sm outline-none focus:border-blue-400" />
          <button onClick={create} disabled={saving || !newName.trim()} className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50">{saving ? "..." : "Criar"}</button>
          <button onClick={() => setCreating(false)} className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-600">Cancelar</button>
        </div>
      )}

      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setEditing(null)}>
          <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-slate-800">Editar colunas — {editing.name}</h3>
              <button onClick={() => setEditing(null)} className="text-slate-400 hover:text-slate-600 text-lg leading-none">✕</button>
            </div>

            <div className="space-y-1.5 mb-4 max-h-64 overflow-y-auto">
              {editCols.map((col, idx) => (
                <div key={col.id} className="flex items-center gap-2 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
                  <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: col.color }} />
                  <span className="flex-1 text-sm font-medium text-slate-700 truncate">{col.label}</span>
                  <button onClick={() => moveCol(idx, -1)} disabled={idx === 0} className="text-slate-300 hover:text-slate-600 disabled:opacity-20 text-xs px-1">▲</button>
                  <button onClick={() => moveCol(idx, 1)} disabled={idx === editCols.length - 1} className="text-slate-300 hover:text-slate-600 disabled:opacity-20 text-xs px-1">▼</button>
                  <button onClick={() => removeCol(idx)} className="text-slate-300 hover:text-red-500 text-xs px-1">✕</button>
                </div>
              ))}
            </div>

            <div className="flex gap-2 mb-4">
              <div className="flex gap-1 flex-wrap">
                {COL_COLORS.map((c) => (
                  <button key={c} onClick={() => setNewColColor(c)}
                    className="w-5 h-5 rounded-full border-2 transition"
                    style={{ background: c, borderColor: newColColor === c ? "#1e293b" : "transparent" }} />
                ))}
              </div>
              <input value={newColName} onChange={(e) => setNewColName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addCol()} placeholder="Nome da coluna"
                className="flex-1 rounded-lg border border-slate-200 px-3 py-1.5 text-sm outline-none focus:border-blue-400" />
              <button onClick={addCol} disabled={!newColName.trim()} className="rounded-lg bg-slate-800 px-3 py-1.5 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-40">+ Add</button>
            </div>

            <div className="flex justify-end gap-2">
              <button onClick={() => setEditing(null)} className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600">Cancelar</button>
              <button onClick={saveEdit} disabled={saving || editCols.length === 0} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50">{saving ? "Salvando..." : "Salvar"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Board Principal ──────────────────────────────────────────────────────────
export function KanbanBoard({
  initialLeads,
  initialFunnels,
  clients,
  selectedClient,
}: {
  initialLeads: Lead[];
  initialFunnels: Funnel[];
  clients: ClientOption[];
  selectedClient?: string;
}) {
  const [leads, setLeads]     = useState<Lead[]>(initialLeads);
  const [funnels, setFunnels] = useState<Funnel[]>(initialFunnels);
  const [activeFunnel, setActiveFunnel] = useState<string>(initialFunnels[0]?.id ?? "default");
  const filterClient = selectedClient ?? clients[0]?.id ?? "all";
  const [search, setSearch]   = useState("");
  const [selected, setSelected]     = useState<Lead | null>(null);
  const [showNewForm, setShowNewForm] = useState(false);
  const [showFunnelMgr, setShowFunnelMgr] = useState(false);
  const [newLead, setNewLead] = useState({ name: "", phone: "", email: "", campaignName: "", value: "", clientId: clients[0]?.id ?? "" });
  const [saving, setSaving]   = useState(false);
  const draggingId = useRef<string | null>(null);

  const funnel = funnels.find((f) => f.id === activeFunnel) ?? funnels[0];

  const filtered = leads.filter((l) => {
    if (l.funnelId !== funnel?.id) return false;
    if (filterClient !== "all" && l.clientId !== filterClient) return false;
    if (search) {
      const q = search.toLowerCase();
      return l.name.toLowerCase().includes(q) || l.phone.includes(q) || (l.campaignName ?? "").toLowerCase().includes(q);
    }
    return true;
  });

  const byCol = (colId: string) => filtered
    .filter((l) => l.status === colId)
    .sort((a, b) => new Date(b.updatedAt ?? b.createdAt).getTime() - new Date(a.updatedAt ?? a.createdAt).getTime());

  // Stats
  const totalValue  = filtered.reduce((s, l) => s + (l.value ?? 0), 0);
  const ganhos      = filtered.filter((l) => l.status === "ganho");
  const ganhoValue  = ganhos.reduce((s, l) => s + (l.value ?? 0), 0);
  const conversion  = filtered.length > 0 ? ((ganhos.length / filtered.length) * 100).toFixed(0) : "0";

  // Drag & Drop
  function onDragStart(id: string) { draggingId.current = id; }
  function onDragOver(e: React.DragEvent) { e.preventDefault(); }
  async function onDrop(colId: string) {
    const id = draggingId.current;
    if (!id) return;
    draggingId.current = null;
    const lead = leads.find((l) => l.id === id);
    if (!lead || lead.status === colId) return;
    setLeads((prev) => prev.map((l) => l.id === id ? { ...l, status: colId } : l));
    await fetch(`/api/crm/leads/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: colId }),
    });
  }

  function handleUpdated(updated: Lead) {
    setLeads((prev) => prev.map((l) => l.id === updated.id ? updated : l));
    setSelected(updated);
  }

  function handleDeleted(id: string) {
    setLeads((prev) => prev.filter((l) => l.id !== id));
    setSelected(null);
  }

  async function createLead() {
    if (!newLead.phone.trim() || !newLead.clientId) return;
    setSaving(true);
    const res = await fetch("/api/crm/leads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientId: newLead.clientId,
        funnelId: funnel?.id ?? "default",
        name: newLead.name || "Sem nome",
        phone: newLead.phone,
        email: newLead.email || null,
        campaignName: newLead.campaignName || null,
        value: newLead.value ? Number(newLead.value) : null,
        source: "manual",
        status: funnel?.columns[0]?.id ?? "novo",
      }),
    });
    const lead = await res.json();
    if (res.ok) {
      setLeads((prev) => [lead, ...prev]);
      setNewLead({ name: "", phone: "", email: "", campaignName: "", value: "", clientId: clients[0]?.id ?? "" });
      setShowNewForm(false);
    }
    setSaving(false);
  }

  if (!funnel) return <p className="text-slate-400 text-sm">Nenhum funil encontrado.</p>;

  return (
    <div className="flex flex-col h-full gap-3">

      {/* Stats bar */}
      <div className="grid grid-cols-4 gap-3 flex-shrink-0">
        {[
          { label: "Total de leads", value: String(filtered.length), sub: `${funnels.length} funil${funnels.length !== 1 ? "s" : ""}` },
          { label: "Valor no pipeline", value: fmt(totalValue), sub: "soma dos leads ativos" },
          { label: "Ganhos", value: String(ganhos.length), sub: fmt(ganhoValue) },
          { label: "Conversão", value: `${conversion}%`, sub: "leads → ganhos" },
        ].map((s) => (
          <div key={s.label} className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
            <p className="text-xs text-slate-500">{s.label}</p>
            <p className="text-xl font-bold text-slate-900 mt-0.5">{s.value}</p>
            <p className="text-xs text-slate-400 mt-0.5">{s.sub}</p>
          </div>
        ))}
      </div>

      {/* Funnel manager */}
      {showFunnelMgr && <FunnelManager funnels={funnels} onUpdated={setFunnels} clientId={selectedClient} />}

      {/* Toolbar */}
      <div className="flex items-center gap-2 flex-shrink-0 flex-wrap">
        {/* Funnel tabs */}
        <div className="flex gap-1 bg-slate-100 rounded-lg p-1 flex-wrap">
          {funnels.map((f) => (
            <button
              key={f.id}
              onClick={() => setActiveFunnel(f.id)}
              className={clsx(
                "rounded-md px-3 py-1.5 text-sm font-medium transition",
                activeFunnel === f.id ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"
              )}
            >
              {f.name}
            </button>
          ))}
          <button onClick={() => setShowFunnelMgr((v) => !v)} className="rounded-md px-2 py-1.5 text-sm text-slate-400 hover:text-slate-600 transition" title="Gerenciar funis">
            ⚙️
          </button>
        </div>

        {/* Search */}
        <div className="relative flex-1 min-w-[180px]">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar lead..."
            className="w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 py-1.5 text-sm outline-none focus:border-blue-400"
          />
        </div>


        <button
          onClick={() => setShowNewForm(true)}
          className="ml-auto rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-blue-700 transition shrink-0"
        >
          + Novo lead
        </button>
      </div>

      {/* New lead inline form */}
      {showNewForm && (
        <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 flex-shrink-0">
          <p className="text-sm font-semibold text-blue-800 mb-3">Novo lead — {funnel.name}</p>
          <div className="grid grid-cols-3 gap-2 mb-3">
            <select value={newLead.clientId} onChange={(e) => setNewLead((f) => ({ ...f, clientId: e.target.value }))}
              className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm outline-none focus:border-blue-400 bg-white col-span-3">
              <option value="">Selecionar cliente *</option>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <input value={newLead.name} onChange={(e) => setNewLead((f) => ({ ...f, name: e.target.value }))}
              placeholder="Nome" className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm outline-none focus:border-blue-400" />
            <input value={newLead.phone} onChange={(e) => setNewLead((f) => ({ ...f, phone: e.target.value }))}
              placeholder="Telefone *" className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm outline-none focus:border-blue-400" />
            <input value={newLead.email} onChange={(e) => setNewLead((f) => ({ ...f, email: e.target.value }))}
              placeholder="E-mail" className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm outline-none focus:border-blue-400" />
            <input value={newLead.campaignName} onChange={(e) => setNewLead((f) => ({ ...f, campaignName: e.target.value }))}
              placeholder="Campanha de origem" className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm outline-none focus:border-blue-400" />
            <input value={newLead.value} onChange={(e) => setNewLead((f) => ({ ...f, value: e.target.value }))}
              type="number" placeholder="Valor estimado R$" className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm outline-none focus:border-blue-400" />
          </div>
          <div className="flex gap-2">
            <button onClick={() => setShowNewForm(false)} className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50">Cancelar</button>
            <button onClick={createLead} disabled={saving || !newLead.phone.trim() || !newLead.clientId}
              className="rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
              {saving ? "Salvando..." : "Criar lead"}
            </button>
          </div>
        </div>
      )}

      {/* Kanban */}
      <div className="flex gap-3 overflow-x-auto flex-1 min-h-0 pb-2">
        {funnel.columns.map((col) => {
          const colLeads = byCol(col.id);
          const colValue = colLeads.reduce((s, l) => s + (l.value ?? 0), 0);
          return (
            <div
              key={col.id}
              onDragOver={onDragOver}
              onDrop={() => onDrop(col.id)}
              className="flex flex-col w-60 flex-shrink-0"
            >
              {/* Column header */}
              <div
                className="rounded-t-xl px-3 py-2.5 border-x border-t"
                style={{ background: hexToLight(col.color), borderColor: col.color + "55" }}
              >
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: col.color }} />
                  <span className="text-sm font-semibold text-slate-700 truncate">{col.label}</span>
                  {col.id === "entrada" && (
                    <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-indigo-100 text-indigo-600 border border-indigo-200 shrink-0">auto</span>
                  )}
                  <span className="ml-auto rounded-full bg-white/80 px-2 py-0.5 text-xs font-bold text-slate-600 border shrink-0" style={{ borderColor: col.color + "44" }}>
                    {colLeads.length}
                  </span>
                </div>
                {col.id === "entrada" && (
                  <p className="text-[10px] text-indigo-500 mt-0.5 pl-4">Arraste para avançar no funil</p>
                )}
                {colValue > 0 && col.id !== "entrada" && <p className="text-xs text-slate-500 mt-0.5 pl-4">{fmt(colValue)}</p>}
              </div>

              {/* Cards */}
              <div
                className="flex-1 rounded-b-xl border-x border-b p-2 space-y-2 overflow-y-auto"
                style={{ background: hexToLight(col.color) + "88", borderColor: col.color + "55" }}
              >
                {colLeads.map((lead) => {
                  const client = clients.find((c) => c.id === lead.clientId);
                  const days = daysSince(lead.updatedAt ?? lead.createdAt);
                  return (
                    <div
                      key={lead.id}
                      draggable
                      onDragStart={() => onDragStart(lead.id)}
                      onClick={() => setSelected(lead)}
                      className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm cursor-pointer hover:shadow-md hover:border-blue-300 transition select-none"
                    >
                      {/* Client badge */}
                      {client && (
                        <div className="flex items-center gap-1 mb-1.5">
                          <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: client.color }} />
                          <span className="text-xs text-slate-400 truncate">{client.name}</span>
                        </div>
                      )}

                      <div className="flex items-start justify-between gap-1 mb-1">
                        <p className="font-semibold text-slate-800 text-sm leading-tight line-clamp-1">{lead.name}</p>
                        {lead.ai && (
                          <span className={clsx("rounded-full px-1.5 py-0.5 text-xs font-bold shrink-0", SCORE_COLOR(lead.ai.score))}>
                            {lead.ai.score}
                          </span>
                        )}
                      </div>

                      <p className="text-xs text-slate-500 mb-2 font-mono">{lead.phone}</p>

                      <div className="flex items-center gap-1 flex-wrap mb-1">
                        <span className="text-xs">{SOURCE_ICON[lead.source] ?? "📌"}</span>
                        {lead.campaignName && (
                          <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600 truncate max-w-[100px]">
                            {lead.campaignName}
                          </span>
                        )}
                        {lead.value != null && (
                          <span className="rounded-full bg-green-100 px-1.5 py-0.5 text-xs text-green-700 font-medium">
                            {fmt(lead.value)}
                          </span>
                        )}
                      </div>

                      {lead.ai?.nextStep && (
                        <p className="text-xs text-slate-400 italic line-clamp-1">→ {lead.ai.nextStep}</p>
                      )}

                      <p className="mt-1.5 text-xs text-slate-300">
                        {days === 0 ? "Hoje" : `${days}d atrás`}
                      </p>
                    </div>
                  );
                })}

                {colLeads.length === 0 && (
                  <div className="flex items-center justify-center h-16 text-xs text-slate-400 italic select-none">
                    Arraste aqui
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Modal */}
      {selected && (
        <LeadModal
          lead={selected}
          funnel={funnel}
          onClose={() => setSelected(null)}
          onUpdated={handleUpdated}
          onDeleted={handleDeleted}
        />
      )}
    </div>
  );
}
