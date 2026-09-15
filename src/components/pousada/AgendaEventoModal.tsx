"use client";

import { useMemo, useState } from "react";
import { CalendarDays, Clock3, FileText, LoaderCircle, Tag, Trash2, X } from "lucide-react";
import type { EventoAgendaPousada, PousadaTipo } from "@/lib/pousada-types";
import { COR_EVENTO_GERAL, CORES_AGENDA } from "@/lib/pousada-calendar";

type Props = {
  clientId: string;
  tipos: PousadaTipo[];
  evento?: EventoAgendaPousada | null;
  initialDate: string;
  onClose: () => void;
  onSaved: () => void;
};

export function AgendaEventoModal({ clientId, tipos, evento, initialDate, onClose, onSaved }: Props) {
  const tiposEvento = useMemo(
    () => tipos.filter((tipo) => (tipo.categoria ?? "evento") === "evento" && tipo.ativo !== false),
    [tipos],
  );
  const [titulo, setTitulo] = useState(evento?.titulo ?? "");
  const [tipo, setTipo] = useState(evento?.tipo ?? tiposEvento[0]?.slug ?? "evento_geral");
  const [data, setData] = useState(evento?.data ?? initialDate);
  const [hora, setHora] = useState(evento?.hora ?? "");
  const [observacoes, setObservacoes] = useState(evento?.observacoes ?? "");
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState("");

  const tipoIndex = tipos.findIndex((item) => item.slug === tipo);
  const cor = tipo === "evento_geral" || tipoIndex < 0
    ? COR_EVENTO_GERAL
    : CORES_AGENDA[tipoIndex % CORES_AGENDA.length];

  async function save() {
    if (!titulo.trim() || !data) {
      setError("Preencha o título e a data do evento.");
      return;
    }

    setSaving(true);
    setError("");
    try {
      const response = await fetch(evento ? `/api/pousada/agenda/${evento.id}` : "/api/pousada/agenda", {
        method: evento ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId, titulo, tipo, data, hora, observacoes }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(payload.error ?? "Não foi possível salvar o evento.");
        return;
      }
      onSaved();
    } catch {
      setError("Falha de conexão ao salvar o evento.");
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!evento || !window.confirm(`Remover “${evento.titulo}” da agenda?`)) return;
    setRemoving(true);
    setError("");
    try {
      const response = await fetch(`/api/pousada/agenda/${evento.id}`, { method: "DELETE" });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        setError(payload.error ?? "Não foi possível remover o evento.");
        return;
      }
      onSaved();
    } catch {
      setError("Falha de conexão ao remover o evento.");
    } finally {
      setRemoving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="agenda-evento-title"
        className="w-full max-w-lg overflow-hidden rounded-lg bg-white shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between border-b border-slate-200 px-5 py-4">
          <div>
            <h2 id="agenda-evento-title" className="text-base font-semibold text-slate-900">
              {evento ? "Editar evento programado" : "Novo evento programado"}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            title="Fechar"
            className="grid h-8 w-8 place-items-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            <X size={18} />
          </button>
        </div>

        <div className="space-y-4 px-5 py-5">
          <label className="block">
            <span className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-slate-600">
              <Tag size={14} /> Título
            </span>
            <input
              autoFocus
              value={titulo}
              onChange={(event) => setTitulo(event.target.value)}
              placeholder="Ex.: Almoço de Dia das Mães"
              className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-100"
            />
          </label>

          <label className="block">
            <span className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-slate-600">
              <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: cor.principal }} /> Tipo e cor
            </span>
            <select
              value={tipo}
              onChange={(event) => setTipo(event.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-100"
            >
              <option value="evento_geral">Evento geral</option>
              {tiposEvento.map((item) => (
                <option key={item.slug} value={item.slug}>{item.label}</option>
              ))}
            </select>
          </label>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-slate-600">
                <CalendarDays size={14} /> Data
              </span>
              <input
                type="date"
                value={data}
                onChange={(event) => setData(event.target.value)}
                className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-100"
              />
            </label>
            <label className="block">
              <span className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-slate-600">
                <Clock3 size={14} /> Horário
              </span>
              <input
                type="time"
                value={hora}
                onChange={(event) => setHora(event.target.value)}
                className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-100"
              />
            </label>
          </div>

          <label className="block">
            <span className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-slate-600">
              <FileText size={14} /> Observações
            </span>
            <textarea
              value={observacoes}
              onChange={(event) => setObservacoes(event.target.value)}
              rows={3}
              placeholder="Informações internas sobre o evento"
              className="w-full resize-none rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-100"
            />
          </label>

          {error && <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        </div>

        <div className="flex items-center gap-2 border-t border-slate-200 bg-slate-50 px-5 py-4">
          {evento && (
            <button
              type="button"
              onClick={remove}
              disabled={removing || saving}
              className="inline-flex items-center gap-2 rounded-lg border border-red-200 bg-white px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
            >
              {removing ? <LoaderCircle size={16} className="animate-spin" /> : <Trash2 size={16} />}
              Remover
            </button>
          )}
          <div className="flex-1" />
          <button type="button" onClick={onClose} className="rounded-lg px-3 py-2 text-sm text-slate-600 hover:bg-slate-200">
            Cancelar
          </button>
          <button
            type="button"
            onClick={save}
            disabled={saving || removing}
            className="inline-flex items-center gap-2 rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-700 disabled:opacity-50"
          >
            {saving && <LoaderCircle size={16} className="animate-spin" />}
            Salvar evento
          </button>
        </div>
      </div>
    </div>
  );
}
