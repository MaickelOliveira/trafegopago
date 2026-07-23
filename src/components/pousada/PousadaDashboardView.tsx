"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import type { Reserva, PousadaTipo, CategoriaTipo } from "@/lib/pousada-types";
import { ReservaModal } from "./ReservaModal";
import { PousadaSubNav } from "./PousadaSubNav";

function fmt(v: number) {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function slugify(label: string): string {
  return label
    .toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function PousadaDashboardView({ clientId, role }: { clientId: string; role: "manager" | "client" }) {
  const [tipos, setTipos] = useState<PousadaTipo[]>([]);
  const [reservas, setReservas] = useState<Reserva[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState<"new" | Reserva | null>(null);
  const [editingTipos, setEditingTipos] = useState(false);
  const [tiposDraft, setTiposDraft] = useState<PousadaTipo[]>([]);
  const [novoTipoLabel, setNovoTipoLabel] = useState("");
  const [novoTipoCategoria, setNovoTipoCategoria] = useState<CategoriaTipo>("evento");

  const load = useCallback(async () => {
    setLoading(true);
    const [tiposRes, reservasRes] = await Promise.all([
      fetch(`/api/pousada/tipos?clientId=${clientId}`).then((r) => r.json()),
      fetch(`/api/pousada/reservas?clientId=${clientId}`).then((r) => r.json()),
    ]);
    setTipos(Array.isArray(tiposRes) ? tiposRes : []);
    setReservas(reservasRes.reservas ?? []);
    setLoading(false);
  }, [clientId]);

  useEffect(() => { load(); }, [load]);

  const today = new Date().toISOString().slice(0, 10);
  const upcoming = reservas
    .filter((r) => r.data >= today && r.status !== "cancelada")
    .sort((a, b) => a.data.localeCompare(b.data));

  const aReceber = upcoming.reduce((s, r) => s + r.faltaPagar, 0);

  function reservasDoTipo(slug: string) {
    return upcoming.filter((r) => r.tipo === slug);
  }

  function categoriaDoTipo(slug: string): CategoriaTipo {
    return tipos.find((t) => t.slug === slug)?.categoria ?? "evento";
  }

  async function saveTipos() {
    const res = await fetch("/api/pousada/tipos", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientId, tipos: tiposDraft }),
    });
    if (res.ok) {
      setTipos(tiposDraft);
      setEditingTipos(false);
    }
  }

  function addTipoDraft() {
    const label = novoTipoLabel.trim();
    if (!label) return;
    const slug = slugify(label);
    if (!slug || tiposDraft.some((t) => t.slug === slug)) return;
    setTiposDraft((prev) => [...prev, { slug, label, categoria: novoTipoCategoria }]);
    setNovoTipoLabel("");
  }

  if (loading) {
    return (
      <div>
        <PousadaSubNav clientId={clientId} role={role} />
        <div className="p-8 text-sm text-slate-400">Carregando...</div>
      </div>
    );
  }

  return (
    <div>
      <PousadaSubNav clientId={clientId} role={role} />
      <div className="p-6 md:p-10 space-y-10 max-w-5xl mx-auto">
      {/* Cabeçalho */}
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold text-slate-900 flex items-center gap-2">🏡 Pousada</h1>
        <p className="text-sm text-slate-500">Reservas de hospedagem, day use, almoço e eventos em um só lugar.</p>
      </div>

      {/* Ações */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => setModal("new")}
          className="rounded-lg bg-amber-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-amber-700"
        >
          + Nova reserva
        </button>
        <button
          onClick={() => { setTiposDraft(tipos.length ? [...tipos] : []); setEditingTipos(true); }}
          className="rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-600 hover:bg-slate-50 ml-auto"
        >
          ⚙️ Tipos de reserva
        </button>
      </div>

      {/* Resumo */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <p className="text-xs uppercase tracking-wide text-slate-400">Próximas reservas</p>
          <p className="text-3xl font-semibold text-slate-900 mt-1">{upcoming.length}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <p className="text-xs uppercase tracking-wide text-slate-400">A receber</p>
          <p className="text-3xl font-semibold text-amber-600 mt-1">{fmt(aReceber)}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <p className="text-xs uppercase tracking-wide text-slate-400">Tipos de reserva ativos</p>
          <p className="text-3xl font-semibold text-slate-900 mt-1">{tipos.length}</p>
        </div>
      </div>

      {/* Editor de tipos */}
      {editingTipos && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 space-y-4">
          <div>
            <p className="text-sm font-semibold text-amber-900">Tipos de reserva</p>
            <p className="text-xs text-amber-800/70 mt-0.5">
              &quot;Hospedagem&quot; pede quarto/chalé, check-in/check-out e CPF de cada hóspede. &quot;Evento&quot; (Day Use, Almoço, etc.) pede nome, idade e cidade de cada participante.
            </p>
          </div>
          <div className="space-y-2">
            {tiposDraft.map((t, i) => (
              <div key={t.slug} className="flex items-center gap-2">
                <input
                  value={t.label}
                  onChange={(e) => setTiposDraft((prev) => prev.map((x, idx) => (idx === i ? { ...x, label: e.target.value } : x)))}
                  className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-amber-400"
                />
                <select
                  value={t.categoria ?? "evento"}
                  onChange={(e) => setTiposDraft((prev) => prev.map((x, idx) => (idx === i ? { ...x, categoria: e.target.value as CategoriaTipo } : x)))}
                  className="rounded-lg border border-slate-200 px-2 py-2 text-xs outline-none focus:border-amber-400 bg-white"
                >
                  <option value="evento">Evento (day use, almoço...)</option>
                  <option value="hospedagem">Hospedagem (quarto/checkin)</option>
                </select>
                <button onClick={() => setTiposDraft((prev) => prev.filter((_, idx) => idx !== i))} className="text-slate-400 hover:text-red-500 text-xl leading-none px-2">×</button>
              </div>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <input
              value={novoTipoLabel}
              onChange={(e) => setNovoTipoLabel(e.target.value)}
              placeholder="Novo tipo, ex: Dia das Mães"
              className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-amber-400"
            />
            <select
              value={novoTipoCategoria}
              onChange={(e) => setNovoTipoCategoria(e.target.value as CategoriaTipo)}
              className="rounded-lg border border-slate-200 px-2 py-2 text-xs outline-none focus:border-amber-400 bg-white"
            >
              <option value="evento">Evento</option>
              <option value="hospedagem">Hospedagem</option>
            </select>
            <button onClick={addTipoDraft} className="rounded-lg border border-amber-300 px-3 py-2 text-sm text-amber-800 hover:bg-amber-100 whitespace-nowrap">
              + Adicionar
            </button>
          </div>
          <div className="flex gap-2 pt-1">
            <button onClick={saveTipos} className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-700">Salvar</button>
            <button onClick={() => setEditingTipos(false)} className="text-sm text-slate-500 hover:text-slate-700 px-3 py-2">Cancelar</button>
          </div>
        </div>
      )}

      {/* Uma seção por tipo de reserva — clique abre a página do serviço com tudo + filtro de datas */}
      <div className="space-y-4">
        <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wide">Por tipo de reserva</h2>
        {tipos.length === 0 && (
          <p className="text-sm text-slate-400">Nenhum tipo de reserva configurado ainda — clique em &quot;Tipos de reserva&quot; acima pra adicionar.</p>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {tipos.map((t) => {
            const lista = reservasDoTipo(t.slug);
            const categoria = categoriaDoTipo(t.slug);
            return (
              <Link
                key={t.slug}
                href={`${role === "manager" ? `/gestor/${clientId}/pousada` : "/cliente/pousada"}/servico/${t.slug}`}
                className="rounded-2xl border border-slate-200 bg-white p-5 flex items-center justify-between hover:border-amber-300 hover:bg-amber-50/40 transition"
              >
                <span className="font-medium text-slate-800 flex items-center gap-2">
                  {categoria === "hospedagem" ? "🛏️" : "🎉"} {t.label}
                </span>
                <span className="flex items-center gap-2 text-sm text-slate-400">
                  {lista.length} próxima{lista.length === 1 ? "" : "s"}
                  <span className="text-slate-300">→</span>
                </span>
              </Link>
            );
          })}
        </div>
      </div>

      {modal && (
        <ReservaModal
          clientId={clientId}
          tipos={tipos}
          initial={modal === "new" ? null : modal}
          onSave={() => load()}
          onClose={() => setModal(null)}
        />
      )}
      </div>
    </div>
  );
}
