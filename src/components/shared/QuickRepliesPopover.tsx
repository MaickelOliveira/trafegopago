"use client";

import { useEffect, useRef, useState } from "react";

export interface QuickReply {
  id: string;
  shortcut: string;
  title: string;
  text: string;
  imageUrl?: string;
}

// ─── Picker (shown while typing /) ────────────────────────────────────────────

interface PickerProps {
  clientId: string;
  query: string; // text after "/" (empty = show all)
  onSelect: (reply: QuickReply) => void;
  onOpenManager: () => void;
}

export function QuickRepliesPicker({ clientId, query, onSelect, onOpenManager }: PickerProps) {
  const [replies, setReplies] = useState<QuickReply[]>([]);
  const [cursor, setCursor] = useState(0);

  useEffect(() => {
    fetch(`/api/quick-replies?clientId=${encodeURIComponent(clientId)}`)
      .then((r) => r.ok ? r.json() : [])
      .then(setReplies)
      .catch(() => {});
  }, [clientId]);

  const filtered = replies.filter((r) => {
    if (!query) return true;
    const q = query.toLowerCase();
    return r.shortcut.toLowerCase().includes(q) || r.title.toLowerCase().includes(q);
  });

  useEffect(() => { setCursor(0); }, [query]);

  // Keyboard navigation (caller must forward keydown events)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown") { e.preventDefault(); setCursor((c) => Math.min(c + 1, filtered.length - 1)); }
      if (e.key === "ArrowUp")   { e.preventDefault(); setCursor((c) => Math.max(c - 1, 0)); }
      if (e.key === "Enter" && filtered[cursor]) { e.preventDefault(); e.stopPropagation(); onSelect(filtered[cursor]); }
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [filtered, cursor, onSelect]);

  if (filtered.length === 0 && !query) {
    return (
      <div className="absolute bottom-full left-0 right-0 mb-2 bg-white rounded-xl border border-slate-200 shadow-xl z-50 overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-100 bg-slate-50">
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">⚡ Respostas rápidas</span>
          <button onClick={onOpenManager} className="text-xs text-indigo-600 hover:text-indigo-800 font-semibold">+ Criar primeira</button>
        </div>
        <p className="text-sm text-slate-400 italic px-4 py-3">Nenhuma resposta cadastrada.</p>
      </div>
    );
  }

  if (filtered.length === 0) return null;

  return (
    <div className="absolute bottom-full left-0 right-0 mb-2 bg-white rounded-xl border border-slate-200 shadow-xl z-50 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 border-b border-slate-100 bg-slate-50">
        <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">⚡ Respostas rápidas</span>
        <button onClick={onOpenManager} className="text-xs text-indigo-600 hover:text-indigo-800 font-semibold">Gerenciar</button>
      </div>
      <div className="max-h-56 overflow-y-auto">
        {filtered.map((r, i) => (
          <button
            key={r.id}
            onClick={() => onSelect(r)}
            className={`w-full text-left px-4 py-2.5 flex gap-3 items-start transition ${i === cursor ? "bg-indigo-50" : "hover:bg-slate-50"}`}
          >
            <span className="text-xs font-mono font-bold text-indigo-600 shrink-0 mt-0.5">/{r.shortcut}</span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-slate-800 truncate">{r.title}</p>
              <p className="text-xs text-slate-500 truncate">{r.text}</p>
            </div>
            {r.imageUrl && <span className="text-base shrink-0">🖼️</span>}
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── Manager modal ─────────────────────────────────────────────────────────────

interface ManagerProps {
  clientId: string;
  onClose: () => void;
}

const EMPTY_FORM = { shortcut: "", title: "", text: "", imageUrl: "" };

export function QuickRepliesManager({ clientId, onClose }: ManagerProps) {
  const [replies, setReplies] = useState<QuickReply[]>([]);
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  function load() {
    fetch(`/api/quick-replies?clientId=${encodeURIComponent(clientId)}`)
      .then((r) => r.ok ? r.json() : [])
      .then(setReplies)
      .catch(() => {});
  }

  useEffect(load, [clientId]);

  function startEdit(r: QuickReply) {
    setEditingId(r.id);
    setForm({ shortcut: r.shortcut, title: r.title, text: r.text, imageUrl: r.imageUrl ?? "" });
  }

  function cancelEdit() {
    setEditingId(null);
    setForm(EMPTY_FORM);
  }

  async function uploadImage(file: File) {
    setUploading(true);
    const fd = new FormData();
    fd.append("file", file);
    try {
      const res = await fetch("/api/upload", { method: "POST", body: fd });
      const data = await res.json();
      if (res.ok && data.url) setForm((f) => ({ ...f, imageUrl: data.url }));
    } finally {
      setUploading(false);
    }
  }

  async function saveReply() {
    if (!form.shortcut.trim() || !form.title.trim() || !form.text.trim()) return;
    setSaving(true);
    const body = { clientId, shortcut: form.shortcut, title: form.title, text: form.text, imageUrl: form.imageUrl || undefined };
    const url = editingId ? `/api/quick-replies/${editingId}` : "/api/quick-replies";
    const method = editingId ? "PUT" : "POST";
    await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    setSaving(false);
    cancelEdit();
    load();
  }

  async function removeReply(id: string) {
    if (!confirm("Excluir esta resposta rápida?")) return;
    await fetch(`/api/quick-replies/${id}?clientId=${encodeURIComponent(clientId)}`, { method: "DELETE" });
    load();
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="w-full max-w-xl bg-white rounded-2xl shadow-2xl overflow-hidden flex flex-col"
        style={{ maxHeight: "85vh" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 shrink-0 bg-gradient-to-r from-indigo-50 to-white">
          <div>
            <h2 className="text-base font-bold text-slate-900">⚡ Respostas Rápidas</h2>
            <p className="text-xs text-slate-500 mt-0.5">Digite <span className="font-mono font-bold text-indigo-600">/atalho</span> no chat para usar</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 p-1 rounded-lg hover:bg-slate-100">
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Form */}
        <div className="p-5 border-b border-slate-100 shrink-0 space-y-3 bg-slate-50">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
            {editingId ? "✏️ Editando resposta" : "➕ Nova resposta rápida"}
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-slate-500 mb-1">Atalho <span className="text-slate-400">(sem /)</span></label>
              <input
                value={form.shortcut}
                onChange={(e) => setForm((f) => ({ ...f, shortcut: e.target.value.replace(/\s/g, "").replace(/^\//, "") }))}
                placeholder="ex: oi, preco, obg"
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400 bg-white"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1">Título</label>
              <input
                value={form.title}
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                placeholder="ex: Saudação inicial"
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400 bg-white"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">Texto da mensagem</label>
            <textarea
              value={form.text}
              onChange={(e) => setForm((f) => ({ ...f, text: e.target.value }))}
              placeholder="Olá! Como posso ajudar você hoje?"
              rows={3}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400 resize-none bg-white"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">Foto <span className="text-slate-400">(opcional)</span></label>
            <div className="flex gap-2">
              <input
                value={form.imageUrl}
                onChange={(e) => setForm((f) => ({ ...f, imageUrl: e.target.value }))}
                placeholder="https://... ou faça upload →"
                className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400 bg-white"
              />
              <button
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
                className="shrink-0 rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-600 hover:bg-slate-100 disabled:opacity-50 font-medium"
              >
                {uploading ? "⏳" : "📁 Upload"}
              </button>
              <input ref={fileRef} type="file" accept="image/*" className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadImage(f); e.target.value = ""; }} />
            </div>
            {form.imageUrl && (
              <div className="mt-2 flex items-center gap-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={form.imageUrl} alt="preview" className="h-16 w-16 object-cover rounded-lg border border-slate-200" onError={(e) => (e.currentTarget.style.display = "none")} />
                <button onClick={() => setForm((f) => ({ ...f, imageUrl: "" }))} className="text-xs text-red-500 hover:text-red-700">Remover foto</button>
              </div>
            )}
          </div>
          <div className="flex gap-2 justify-end">
            {editingId && (
              <button onClick={cancelEdit} className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 font-medium">
                Cancelar
              </button>
            )}
            <button
              onClick={saveReply}
              disabled={saving || !form.shortcut.trim() || !form.title.trim() || !form.text.trim()}
              className="rounded-lg bg-indigo-600 text-white px-4 py-2 text-sm font-bold hover:bg-indigo-700 disabled:opacity-40 transition"
            >
              {saving ? "Salvando..." : editingId ? "Atualizar" : "Criar resposta"}
            </button>
          </div>
        </div>

        {/* List */}
        <div className="overflow-y-auto flex-1">
          {replies.length === 0 ? (
            <p className="text-sm text-slate-400 italic text-center py-8">Nenhuma resposta cadastrada ainda.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {replies.map((r) => (
                <li key={r.id} className="flex gap-3 px-5 py-3.5 items-start hover:bg-slate-50 transition">
                  {r.imageUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={r.imageUrl} alt="" className="h-12 w-12 object-cover rounded-lg border border-slate-200 shrink-0 mt-0.5"
                      onError={(e) => (e.currentTarget.style.display = "none")} />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-xs font-mono font-bold text-indigo-600">/{r.shortcut}</span>
                      <span className="text-sm font-semibold text-slate-800">{r.title}</span>
                    </div>
                    <p className="text-xs text-slate-500 line-clamp-2 whitespace-pre-wrap">{r.text}</p>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <button onClick={() => startEdit(r)} className="rounded-lg px-2.5 py-1.5 text-xs text-slate-500 hover:bg-slate-100 font-medium">✏️</button>
                    <button onClick={() => removeReply(r.id)} className="rounded-lg px-2.5 py-1.5 text-xs text-red-500 hover:bg-red-50 font-medium">🗑</button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
