"use client";

import { useState, useRef, useEffect } from "react";
import { clsx } from "clsx";
import { LeadModal, prefetchConversation } from "./LeadModal";
import type { Lead } from "@/lib/leads";
import type { Funnel, FunnelColumn } from "@/lib/funnels";

type ClientOption = { id: string; name: string; color: string; metaAccountId?: string; pixelId?: string; kanbanAgentEnabled?: boolean };

const SCORE_COLOR = (s: number) =>
  s >= 8 ? "text-green-700 bg-green-100" :
  s >= 5 ? "text-yellow-700 bg-yellow-100" :
           "text-red-700 bg-red-100";

/** Ícone de plataforma/origem — Meta, Google, WhatsApp, Formulário, Manual */
function PlatformIcon({ lead }: { lead: Lead }) {
  // Prioridade: adPlatform → source
  if (lead.adPlatform === "meta") return (
    <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 shrink-0" fill="#1877F2" aria-label="Meta">
      <path d="M24 12.073C24 5.405 18.627 0 12 0S0 5.405 0 12.073c0 6.03 4.388 11.021 10.125 11.927v-8.437H7.078v-3.49h3.047V9.413c0-3.027 1.792-4.697 4.533-4.697 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.93-1.956 1.874v2.25h3.328l-.532 3.49h-2.796v8.437C19.612 23.094 24 18.103 24 12.073z"/>
    </svg>
  );
  if (lead.adPlatform === "google") return (
    <svg viewBox="0 0 192 192" className="w-3.5 h-3.5 shrink-0" aria-label="Google Ads">
      {/* perna esquerda do A — azul */}
      <path fill="#4285F4" d="M17 168 L52 168 L104 24 L69 24 Z"/>
      {/* perna direita do A — amarelo */}
      <path fill="#FBBC04" d="M88 24 L123 24 L164 148 L129 148 Z"/>
      {/* círculo — verde */}
      <circle fill="#34A853" cx="152" cy="155" r="30"/>
    </svg>
  );
  if (lead.source === "whatsapp") return (
    <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 shrink-0" fill="#25D366" aria-label="WhatsApp">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
    </svg>
  );
  if (lead.source === "form") return (
    <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 shrink-0 text-slate-500" fill="currentColor" aria-label="Formulário">
      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6zm-1 1.5L18.5 9H13V3.5zM8 13h8v1H8v-1zm0 3h8v1H8v-1zm0-6h4v1H8v-1z"/>
    </svg>
  );
  return <span className="text-xs">✏️</span>;
}

function daysSince(iso: string) {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
}

function fmt(v: number) {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function hexToLight(hex: string): string {
  return hex + "22";
}

// ── Frases de gatilho por coluna ─────────────────────────────────────────────
function TriggerPhrases({ phrases, onChange }: { phrases: string[]; onChange: (p: string[]) => void }) {
  const [input, setInput] = useState("");

  function add() {
    const v = input.trim();
    if (!v || phrases.includes(v)) return;
    onChange([...phrases, v]);
    setInput("");
  }

  return (
    <div className="mt-1.5 rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 space-y-1.5">
      <p className="text-[11px] font-semibold text-violet-700">🤖 Frases que movem o lead para esta coluna</p>
      {phrases.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {phrases.map((p) => (
            <span key={p} className="inline-flex items-center gap-1 rounded-full bg-white border border-violet-300 px-2 py-0.5 text-[11px] text-violet-700 font-medium">
              &quot;{p}&quot;
              <button onClick={() => onChange(phrases.filter((x) => x !== p))} className="hover:text-red-500 leading-none ml-0.5">×</button>
            </span>
          ))}
        </div>
      )}
      <div className="flex gap-1">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), add())}
          placeholder='ex: "obrigado pela compra", "paguei", "quero fechar"'
          className="flex-1 text-xs rounded border border-violet-200 bg-white px-2 py-1.5 outline-none focus:border-violet-400 placeholder:text-slate-400"
        />
        <button
          onClick={add}
          disabled={!input.trim()}
          className="text-xs rounded bg-violet-600 px-2.5 py-1 text-white font-semibold hover:bg-violet-700 disabled:opacity-40 shrink-0"
        >
          + Add
        </button>
      </div>
      <p className="text-[10px] text-violet-400">Digite e pressione Enter ou clique + Add. O agente detecta variações da frase.</p>
    </div>
  );
}

// ── Gestão de Funis ──────────────────────────────────────────────────────────
const COL_COLORS = ["#3B82F6","#F59E0B","#F97316","#10B981","#8B5CF6","#EC4899","#94A3B8","#EF4444","#14B8A6","#6366F1"];

const META_EVENTS = [
  "Lead", "Purchase", "CompleteRegistration", "InitiateCheckout",
  "AddToCart", "ViewContent", "Contact", "Schedule", "Subscribe",
  "AddToWishlist", "AddPaymentInfo", "Search",
];

const META_CUSTOM_EVENT_TYPES: { value: string; label: string }[] = [
  { value: "LEAD", label: "Lead" },
  { value: "COMPLETE_REGISTRATION", label: "Complete Registration" },
  { value: "PURCHASE", label: "Purchase" },
  { value: "INITIATE_CHECKOUT", label: "Initiate Checkout" },
  { value: "ADD_TO_CART", label: "Add to Cart" },
  { value: "VIEW_CONTENT", label: "View Content" },
  { value: "CONTACT", label: "Contact" },
  { value: "SCHEDULE", label: "Schedule" },
  { value: "SUBSCRIBE", label: "Subscribe" },
  { value: "OTHER", label: "Other" },
];

function FunnelManager({ funnels, onUpdated, clientId, metaAccountId, pixelId }: {
  funnels: Funnel[];
  onUpdated: (f: Funnel[]) => void;
  clientId?: string;
  metaAccountId?: string;
  pixelId?: string;
}) {
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<Funnel | null>(null);
  const [editCols, setEditCols] = useState<FunnelColumn[]>([]);
  const [newColName, setNewColName] = useState("");
  const [newColColor, setNewColColor] = useState(COL_COLORS[0]);
  const [creatingConvIdx, setCreatingConvIdx] = useState<number | null>(null);
  const [convName, setConvName] = useState("");
  const [convType, setConvType] = useState("LEAD");
  const [convSaving, setConvSaving] = useState(false);

  async function create() {
    if (!newName.trim()) return;
    setSaving(true);
    const res = await fetch("/api/crm/funnels", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newName, clientId: clientId ?? null }),
    });
    if (!res.ok) { setSaving(false); alert("Erro ao criar funil."); return; }
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

  async function createMetaConversion(colIdx: number) {
    if (!convName.trim() || !metaAccountId || !pixelId) return;
    setConvSaving(true);
    const res = await fetch("/api/meta/custom-conversions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ adAccountId: metaAccountId, name: convName.trim(), customEventType: convType, pixelId }),
    });
    const data = await res.json();
    if (res.ok) {
      setEditCols((prev) => prev.map((c, i) => i === colIdx ? { ...c, metaEvent: convName.trim() } : c));
      setCreatingConvIdx(null);
      setConvName("");
      setConvType("LEAD");
    } else {
      alert(data.error ?? "Erro ao criar evento no Meta");
    }
    setConvSaving(false);
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

            <div className="space-y-2 mb-4 max-h-80 overflow-y-auto pr-1">
              {editCols.map((col, idx) => (
                <div key={col.id} className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 space-y-1.5">
                  <div className="flex items-center gap-2">
                    <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: col.color }} />
                    <span className="flex-1 text-sm font-medium text-slate-700 truncate">{col.label}</span>
                    <button onClick={() => moveCol(idx, -1)} disabled={idx === 0} className="text-slate-300 hover:text-slate-600 disabled:opacity-20 text-xs px-1">▲</button>
                    <button onClick={() => moveCol(idx, 1)} disabled={idx === editCols.length - 1} className="text-slate-300 hover:text-slate-600 disabled:opacity-20 text-xs px-1">▼</button>
                    <button onClick={() => removeCol(idx)} className="text-slate-300 hover:text-red-500 text-xs px-1">✕</button>
                  </div>
                  {/* Flags de comportamento */}
                  <div className="flex items-center gap-3 pl-5">
                    <label className="flex items-center gap-1 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={!!col.blockAutoMove}
                        onChange={(e) => setEditCols((prev) => prev.map((c, i) => i === idx ? { ...c, blockAutoMove: e.target.checked || undefined } : c))}
                        className="rounded accent-violet-600"
                      />
                      <span className="text-[11px] text-slate-500">🔒 Bloqueado p/ IA</span>
                    </label>
                    <label className="flex items-center gap-1 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={!!col.askValueOnMove}
                        onChange={(e) => setEditCols((prev) => prev.map((c, i) => i === idx ? { ...c, askValueOnMove: e.target.checked || undefined } : c))}
                        className="rounded accent-green-600"
                      />
                      <span className="text-[11px] text-slate-500">💰 Pedir valor+data</span>
                    </label>
                  </div>

                  {/* Frases de gatilho — logo abaixo dos flags para visibilidade */}
                  <TriggerPhrases
                    phrases={col.triggerPhrases ?? []}
                    onChange={(phrases) =>
                      setEditCols((prev) =>
                        prev.map((c, i) => i === idx ? { ...c, triggerPhrases: phrases.length ? phrases : undefined } : c)
                      )
                    }
                  />

                  {/* Contexto IA — descrição de quando o lead deve ir para esta coluna */}
                  <div className="mt-1.5 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 space-y-1">
                    <p className="text-[11px] font-semibold text-blue-700">🧠 Contexto IA — quando mover o lead para cá?</p>
                    <textarea
                      value={col.aiDescription ?? ""}
                      onChange={(e) =>
                        setEditCols((prev) =>
                          prev.map((c, i) => i === idx ? { ...c, aiDescription: e.target.value || undefined } : c)
                        )
                      }
                      placeholder={`Ex: Mover quando o lead agendou uma reunião ou demonstrou interesse concreto em marcar um horário`}
                      rows={2}
                      className="w-full text-xs rounded border border-blue-200 px-2 py-1.5 outline-none focus:border-blue-400 bg-white resize-none text-slate-700 placeholder-slate-400"
                    />
                  </div>

                  {/* Whitelist de transições — camada 3 de proteção */}
                  <div className="mt-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 space-y-1.5">
                    <p className="text-[11px] font-semibold text-amber-700">🔒 Destinos permitidos (Camada 3)</p>
                    <p className="text-[10px] text-amber-600">Se marcado, a IA só move leads <b>desta coluna</b> para os destinos selecionados. Vazio = qualquer destino.</p>
                    <div className="flex flex-col gap-1">
                      {editCols
                        .filter((_, i) => i !== idx)
                        .map((dest) => (
                          <label key={dest.id} className="flex items-center gap-1.5 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={(col.allowedTransitions ?? []).includes(dest.id)}
                              onChange={(e) => {
                                setEditCols((prev) =>
                                  prev.map((c, i) => {
                                    if (i !== idx) return c;
                                    const current = c.allowedTransitions ?? [];
                                    const updated = e.target.checked
                                      ? [...current, dest.id]
                                      : current.filter((id) => id !== dest.id);
                                    return { ...c, allowedTransitions: updated.length ? updated : undefined };
                                  })
                                );
                              }}
                              className="rounded accent-amber-600"
                            />
                            <span className="text-[11px] text-slate-600">{dest.label}</span>
                          </label>
                        ))}
                    </div>
                  </div>

                  {/* Seletor de evento Meta CAPI */}
                  <div className="flex items-center gap-1.5 pl-1">
                    <span className="text-[10px] text-slate-400 shrink-0 uppercase tracking-wide">Meta</span>
                    <select
                      value={col.metaEvent ?? ""}
                      onChange={(e) => setEditCols((prev) => prev.map((c, i) => i === idx ? { ...c, metaEvent: e.target.value || undefined } : c))}
                      className="flex-1 text-xs rounded border border-slate-200 px-1 py-0.5 bg-white outline-none focus:border-blue-400"
                    >
                      <option value="">— sem evento —</option>
                      {META_EVENTS.map((ev) => <option key={ev} value={ev}>{ev}</option>)}
                      {col.metaEvent && !META_EVENTS.includes(col.metaEvent) && (
                        <option value={col.metaEvent}>{col.metaEvent} (custom)</option>
                      )}
                    </select>
                    {metaAccountId && pixelId && (
                      <button
                        onClick={() => { setCreatingConvIdx(idx); setConvName(col.label); }}
                        className="text-[10px] text-blue-500 hover:text-blue-700 font-semibold shrink-0 border border-blue-200 rounded px-1 py-0.5 bg-blue-50"
                        title="Criar custom conversion no Meta Ads"
                      >+ Meta</button>
                    )}
                  </div>

                  {/* Form inline para criar custom conversion */}
                  {creatingConvIdx === idx && (
                    <div className="pl-5 space-y-1.5 border-t border-blue-100 pt-1.5 mt-1">
                      <p className="text-[10px] font-semibold text-blue-600 uppercase tracking-wide">Criar no Meta Ads</p>
                      <input
                        value={convName}
                        onChange={(e) => setConvName(e.target.value)}
                        placeholder="Nome do evento"
                        className="w-full text-xs rounded border border-slate-200 px-2 py-1 outline-none focus:border-blue-400"
                      />
                      <select
                        value={convType}
                        onChange={(e) => setConvType(e.target.value)}
                        className="w-full text-xs rounded border border-slate-200 px-1 py-1 bg-white outline-none"
                      >
                        {META_CUSTOM_EVENT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                      </select>
                      <div className="flex gap-1.5">
                        <button onClick={() => setCreatingConvIdx(null)} className="flex-1 text-xs rounded border border-slate-200 py-1 text-slate-500 hover:bg-slate-50">Cancelar</button>
                        <button onClick={() => createMetaConversion(idx)} disabled={convSaving || !convName.trim()} className="flex-1 text-xs rounded bg-blue-600 py-1 text-white font-semibold hover:bg-blue-700 disabled:opacity-50">
                          {convSaving ? "..." : "Criar"}
                        </button>
                      </div>
                    </div>
                  )}
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
  canDeleteLeads = true,
}: {
  initialLeads: Lead[];
  initialFunnels: Funnel[];
  clients: ClientOption[];
  selectedClient?: string;
  canDeleteLeads?: boolean;
}) {
  const [leads, setLeads]     = useState<Lead[]>(initialLeads);
  const [funnels, setFunnels] = useState<Funnel[]>(initialFunnels);
  const [activeFunnel, setActiveFunnel] = useState<string>(() => {
    // Persiste o funil selecionado por cliente no localStorage
    if (typeof window !== "undefined" && selectedClient) {
      const saved = localStorage.getItem(`crm_funnel_${selectedClient}`);
      if (saved && initialFunnels.some(f => f.id === saved)) return saved;
    }
    return initialFunnels[0]?.id ?? "default";
  });
  const filterClient = selectedClient ?? clients[0]?.id ?? "all";
  const [search, setSearch]   = useState("");
  const [selected, setSelected]     = useState<Lead | null>(null);
  const [showNewForm, setShowNewForm] = useState(false);
  const [showFunnelMgr, setShowFunnelMgr] = useState(false);
  const [newLead, setNewLead] = useState({ name: "", phone: "", email: "", campaignName: "", value: "", clientId: clients[0]?.id ?? "" });
  const [saving, setSaving]   = useState(false);
  const draggingId = useRef<string | null>(null);

  // Agente Kanban — liga/desliga
  const [agentEnabled, setAgentEnabled] = useState(
    clients.find((c) => c.id === (selectedClient ?? clients[0]?.id))?.kanbanAgentEnabled !== false
  );
  const [togglingAgent, setTogglingAgent] = useState(false);
  const [classifying, setClassifying] = useState(false);
  const [classifyResult, setClassifyResult] = useState<string | null>(null);

  async function classifyAll() {
    const cid = selectedClient ?? clients[0]?.id;
    if (!cid) return;
    setClassifying(true);
    setClassifyResult(null);
    const res = await fetch(`/api/crm/kanban-agent?clientId=${cid}`, { method: "POST" });
    if (res.ok) {
      const data = await res.json() as { processed: number; moved: number; total: number };
      setClassifyResult(`${data.moved} de ${data.processed} leads movidos`);
      // Recarrega os leads
      const leadsRes = await fetch(`/api/crm/leads?clientId=${cid}`);
      if (leadsRes.ok) setLeads(await leadsRes.json());
      setTimeout(() => setClassifyResult(null), 5000);
    }
    setClassifying(false);
  }

  async function toggleAgent() {
    const cid = selectedClient ?? clients[0]?.id;
    if (!cid) return;
    setTogglingAgent(true);
    const res = await fetch(`/api/crm/kanban-agent?clientId=${cid}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: !agentEnabled }),
    });
    if (res.ok) setAgentEnabled((v) => !v);
    setTogglingAgent(false);
  }

  // Modal valor + data (para colunas com askValueOnMove)
  const [valueModal, setValueModal] = useState<{ leadId: string; colId: string } | null>(null);
  const [valueInput, setValueInput] = useState("");
  const [dateInput, setDateInput] = useState(() => new Date().toISOString().slice(0, 10));

  async function confirmValueModal() {
    if (!valueModal) return;
    await fetch(`/api/crm/leads/${valueModal.leadId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        status: valueModal.colId,
        ...(valueInput ? { value: Number(valueInput) } : {}),
        ...(dateInput ? { notes: `Fechamento: ${dateInput}` } : {}),
      }),
    });
    setLeads((prev) => prev.map((l) =>
      l.id === valueModal.leadId
        ? { ...l, status: valueModal.colId, value: valueInput ? Number(valueInput) : l.value }
        : l
    ));
    setValueModal(null);
    setValueInput("");
  }

  // Meta Ads metrics banner
  const [metricsPeriod, setMetricsPeriod] = useState("last_30d");
  const [metricsOpen, setMetricsOpen] = useState(true);
  const [metricsData, setMetricsData] = useState<Record<string, number> | null>(null);
  const [metricsLoading, setMetricsLoading] = useState(false);
  const currentClientMeta = clients.find((c) => c.id === filterClient);

  // Inicializa Meta Pixel quando o cliente muda
  useEffect(() => {
    const pixelId = currentClientMeta?.pixelId;
    if (!pixelId || typeof window === "undefined") return;
    const w = window as typeof window & { fbq?: (...args: unknown[]) => void; _fbq?: unknown };
    if (!w.fbq) {
      const fn = ((...args: unknown[]) => {
        (fn as { queue?: unknown[] }).queue?.push(args);
      }) as { (...a: unknown[]): void; queue: unknown[]; loaded: boolean; version: string };
      fn.queue = []; fn.loaded = true; fn.version = "2.0";
      w.fbq = fn; w._fbq = fn;
      const s = document.createElement("script");
      s.async = true; s.src = "https://connect.facebook.net/en_US/fbevents.js";
      document.head.appendChild(s);
    }
    w.fbq("init", pixelId);
    w.fbq("track", "PageView");
  }, [currentClientMeta?.pixelId]);

  useEffect(() => {
    const acct = currentClientMeta?.metaAccountId;
    if (!acct) { setMetricsData(null); return; }
    setMetricsLoading(true);
    fetch(`/api/meta/${acct}/insights?datePreset=${metricsPeriod}`)
      .then((r) => r.json())
      .then((d) => { setMetricsData(d); setMetricsLoading(false); })
      .catch(() => setMetricsLoading(false));
  }, [currentClientMeta?.metaAccountId, metricsPeriod]);

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

  // Origens
  const originMeta     = filtered.filter((l) => l.adPlatform === "meta").length;
  const originGoogle   = filtered.filter((l) => l.adPlatform === "google").length;
  const originWhatsapp = filtered.filter((l) => l.source === "whatsapp" && !l.adPlatform).length;
  const originForm     = filtered.filter((l) => l.source === "form" && !l.adPlatform).length;
  const originManual   = filtered.filter((l) => l.source === "manual").length;
  const hasOrigins = originMeta + originGoogle + originWhatsapp + originForm + originManual > 0;


  // Drag & Drop
  function onDragStart(id: string) { draggingId.current = id; }
  function onDragOver(e: React.DragEvent) { e.preventDefault(); }
  async function onDrop(colId: string) {
    const id = draggingId.current;
    if (!id) return;
    draggingId.current = null;
    const lead = leads.find((l) => l.id === id);
    if (!lead || lead.status === colId) return;

    // Se a coluna pede valor+data, abre modal antes de salvar
    const col = funnel?.columns.find((c) => c.id === colId);
    if (col?.askValueOnMove) {
      setValueInput(lead.value != null ? String(lead.value) : "");
      setDateInput(new Date().toISOString().slice(0, 10));
      setValueModal({ leadId: id, colId });
      return;
    }

    setLeads((prev) => prev.map((l) => l.id === id ? { ...l, status: colId } : l));

    // Dispara Pixel (browser) se a coluna tiver metaEvent
    if (col?.metaEvent && currentClientMeta?.pixelId) {
      try {
        const w = window as typeof window & { fbq?: (...args: unknown[]) => void };
        const eventData: Record<string, unknown> = {};
        if (lead.value != null) { eventData.value = lead.value; eventData.currency = "BRL"; }
        w.fbq?.("track", col.metaEvent, eventData);
      } catch { /* fbq não disponível */ }
    }

    // CAPI dispara no servidor via route handler
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

      {/* Origins bar */}
      {hasOrigins && (
        <div className="flex items-center gap-2 flex-shrink-0 flex-wrap">
          <span className="text-xs text-slate-400 font-medium">Origens:</span>
          {originMeta > 0 && (
            <span className="flex items-center gap-1 rounded-full bg-blue-50 border border-blue-200 px-2.5 py-0.5 text-xs font-semibold text-blue-700">
              <svg viewBox="0 0 24 24" className="w-3 h-3" fill="#1877F2"><path d="M24 12.073C24 5.405 18.627 0 12 0S0 5.405 0 12.073c0 6.03 4.388 11.021 10.125 11.927v-8.437H7.078v-3.49h3.047V9.413c0-3.027 1.792-4.697 4.533-4.697 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.93-1.956 1.874v2.25h3.328l-.532 3.49h-2.796v8.437C19.612 23.094 24 18.103 24 12.073z"/></svg>
              Meta Ads · {originMeta}
            </span>
          )}
          {originGoogle > 0 && (
            <span className="flex items-center gap-1 rounded-full bg-red-50 border border-red-200 px-2.5 py-0.5 text-xs font-semibold text-red-700">
              <svg viewBox="0 0 192 192" className="w-3 h-3"><path fill="#4285F4" d="M17 168 L52 168 L104 24 L69 24 Z"/><path fill="#FBBC04" d="M88 24 L123 24 L164 148 L129 148 Z"/><circle fill="#34A853" cx="152" cy="155" r="30"/></svg>
              Google Ads · {originGoogle}
            </span>
          )}
          {originWhatsapp > 0 && (
            <span className="flex items-center gap-1 rounded-full bg-green-50 border border-green-200 px-2.5 py-0.5 text-xs font-semibold text-green-700">
              <svg viewBox="0 0 24 24" className="w-3 h-3" fill="#25D366"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
              WhatsApp · {originWhatsapp}
            </span>
          )}

          {originManual > 0 && (
            <span className="flex items-center gap-1 rounded-full bg-slate-100 border border-slate-200 px-2.5 py-0.5 text-xs font-semibold text-slate-600">
              ✏️ Manual · {originManual}
            </span>
          )}
        </div>
      )}

      {/* Meta Ads Metrics Banner */}
      {currentClientMeta?.metaAccountId && (
        <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-2.5 flex-shrink-0">
          <div className="flex items-center gap-3 flex-wrap">
            <button onClick={() => setMetricsOpen((v) => !v)} className="flex items-center gap-1.5 text-xs font-semibold text-blue-700">
              <svg className="h-3.5 w-3.5 text-blue-500" viewBox="0 0 24 24" fill="currentColor"><path d="M22 12h-4l-3 9L9 3l-3 9H2" stroke="currentColor" strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round"/></svg>
              Meta Ads
              <svg className={`h-3.5 w-3.5 transition-transform ${metricsOpen ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7"/></svg>
            </button>
            {metricsOpen && (
              <select
                value={metricsPeriod}
                onChange={(e) => setMetricsPeriod(e.target.value)}
                className="text-xs rounded border border-blue-200 bg-white px-2 py-0.5 outline-none text-blue-700"
              >
                <option value="today">Hoje</option>
                <option value="yesterday">Ontem</option>
                <option value="last_7d">Últimos 7 dias</option>
                <option value="last_14d">Últimos 14 dias</option>
                <option value="last_30d">Últimos 30 dias</option>
                <option value="this_month">Este mês</option>
                <option value="last_month">Mês passado</option>
              </select>
            )}
            {metricsLoading && <span className="text-xs text-blue-400 animate-pulse">Carregando...</span>}
            {metricsOpen && metricsData && !metricsLoading && (() => {
              const d = metricsData as { spend?: number; leads?: number; costPerLead?: number; purchases?: number; roas?: number; conversations?: number };
              const chips = [
                { label: "Investimento", value: `R$${(d.spend ?? 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` },
                d.leads ? { label: "Leads", value: String(d.leads) } : null,
                d.conversations ? { label: "Conversas", value: String(d.conversations) } : null,
                d.purchases ? { label: "Compras", value: String(d.purchases) } : null,
                d.costPerLead ? { label: "CPL", value: `R$${d.costPerLead.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` } : null,
                d.roas ? { label: "ROAS", value: `${d.roas.toFixed(2)}×` } : null,
              ].filter(Boolean) as { label: string; value: string }[];
              return chips.map((chip) => (
                <div key={chip.label} className="flex items-center gap-1 rounded-full bg-white border border-blue-200 px-2.5 py-0.5">
                  <span className="text-[10px] text-blue-400 uppercase tracking-wide">{chip.label}</span>
                  <span className="text-xs font-bold text-blue-700">{chip.value}</span>
                </div>
              ));
            })()}
          </div>
        </div>
      )}

      {/* Funnel manager */}
      {showFunnelMgr && (
        <FunnelManager
          funnels={funnels}
          onUpdated={setFunnels}
          clientId={selectedClient}
          metaAccountId={clients.find((c) => c.id === filterClient)?.metaAccountId}
          pixelId={clients.find((c) => c.id === filterClient)?.pixelId}
        />
      )}

      {/* Toolbar */}
      <div className="flex items-center gap-2 flex-shrink-0 flex-wrap">
        {/* Funnel tabs */}
        <div className="flex gap-1 bg-slate-100 rounded-lg p-1 flex-wrap">
          {funnels.map((f) => (
            <button
              key={f.id}
              onClick={() => {
                setActiveFunnel(f.id);
                if (selectedClient) localStorage.setItem(`crm_funnel_${selectedClient}`, f.id);
              }}
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


        {/* Toggle agente Kanban IA */}
        <button
          onClick={toggleAgent}
          disabled={togglingAgent}
          title={agentEnabled ? "Agente IA ativo — clique para desativar" : "Agente IA desativado — clique para ativar"}
          className={clsx(
            "rounded-lg border px-3 py-1.5 text-xs font-semibold transition shrink-0 flex items-center gap-1.5",
            agentEnabled
              ? "border-violet-300 bg-violet-50 text-violet-700 hover:bg-violet-100"
              : "border-slate-200 bg-white text-slate-400 hover:bg-slate-50"
          )}
        >
          <span className={clsx("h-2 w-2 rounded-full", agentEnabled ? "bg-violet-500" : "bg-slate-300")} />
          {togglingAgent ? "..." : agentEnabled ? "IA ativa" : "IA desligada"}
        </button>

        {/* Classificar todos os leads com IA */}
        <button
          onClick={classifyAll}
          disabled={classifying}
          title="Analisa a conversa de todos os leads e move cada um para a coluna correta"
          className="rounded-lg border border-violet-200 bg-violet-50 px-3 py-1.5 text-xs font-semibold text-violet-700 hover:bg-violet-100 transition shrink-0 flex items-center gap-1.5 disabled:opacity-50"
        >
          {classifying ? (
            <><svg className="animate-spin h-3 w-3" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/></svg> Classificando...</>
          ) : classifyResult ? (
            <><svg className="h-3 w-3 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7"/></svg> {classifyResult}</>
          ) : (
            <>✦ Classificar leads</>
          )}
        </button>

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
                      onMouseEnter={() => { if (lead.source === "whatsapp") prefetchConversation(lead.phone, lead.clientId); }}
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
                        <div className="flex items-center gap-1 shrink-0">
                          {lead.aiPaused && (
                            <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 flex items-center gap-0.5" title="IA pausada — especialista ativo">
                              ⏸ <span>IA pausada</span>
                            </span>
                          )}
                          {lead.ai && (
                            <span className={clsx("rounded-full px-1.5 py-0.5 text-xs font-bold", SCORE_COLOR(lead.ai.score))}>
                              {lead.ai.score}
                            </span>
                          )}
                        </div>
                      </div>

                      <p className="text-xs text-slate-500 mb-2 font-mono">{lead.realPhone ?? lead.phone}</p>

                      <div className="flex items-center gap-1 flex-wrap mb-1">
                        <PlatformIcon lead={lead} />
                        {lead.campaignName && !["google","meta","facebook","instagram","fb"].includes(lead.campaignName.toLowerCase()) && (
                          <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600 truncate max-w-[100px]">
                            {lead.campaignName}
                          </span>
                        )}
                        {lead.adName && lead.adName !== lead.campaignName && (
                          <span className="rounded-full bg-blue-50 px-1.5 py-0.5 text-xs text-blue-600 truncate max-w-[100px]">
                            {lead.adName}
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

      {/* Modal lead */}
      {selected && (
        <LeadModal
          lead={selected}
          funnel={funnel}
          onClose={() => setSelected(null)}
          onUpdated={handleUpdated}
          onDeleted={handleDeleted}
          canDeleteLeads={canDeleteLeads}
        />
      )}

      {/* Modal valor + data (ao mover para coluna com askValueOnMove) */}
      {valueModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-sm rounded-2xl bg-white shadow-2xl p-6">
            <h3 className="font-semibold text-slate-800 mb-1">
              {funnel.columns.find((c) => c.id === valueModal.colId)?.label ?? "Concluído"}
            </h3>
            <p className="text-sm text-slate-500 mb-4">Preencha os dados do fechamento (opcional)</p>
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Valor (R$)</label>
                <input
                  type="number"
                  value={valueInput}
                  onChange={(e) => setValueInput(e.target.value)}
                  placeholder="0,00"
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-500"
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Data do fechamento</label>
                <input
                  type="date"
                  value={dateInput}
                  onChange={(e) => setDateInput(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-500"
                />
              </div>
            </div>
            <div className="flex gap-2 mt-5">
              <button
                onClick={() => { setValueModal(null); }}
                className="flex-1 rounded-lg border border-slate-200 py-2 text-sm text-slate-600 hover:bg-slate-50"
              >
                Cancelar
              </button>
              <button
                onClick={confirmValueModal}
                className="flex-1 rounded-lg bg-green-600 py-2 text-sm font-semibold text-white hover:bg-green-700"
              >
                Confirmar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
