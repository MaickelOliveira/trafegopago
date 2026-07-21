"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { clsx } from "clsx";
import type { Reserva, PousadaTipo } from "@/lib/pousada-types";
import { ReservaModal } from "./ReservaModal";

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

const STATUS_BADGE: Record<string, string> = {
  pendente: "bg-yellow-100 text-yellow-700",
  parcial: "bg-blue-100 text-blue-700",
  pago: "bg-green-100 text-green-700",
  cancelada: "bg-red-100 text-red-600",
};
const STATUS_LABEL: Record<string, string> = {
  pendente: "Pendente", parcial: "Parcial", pago: "Pago", cancelada: "Cancelada",
};

export function PousadaDashboardView({ clientId, role }: { clientId: string; role: "manager" | "client" }) {
  const [tipos, setTipos] = useState<PousadaTipo[]>([]);
  const [reservas, setReservas] = useState<Reserva[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState<"new" | Reserva | null>(null);
  const [editingTipos, setEditingTipos] = useState(false);
  const [tiposDraft, setTiposDraft] = useState<PousadaTipo[]>([]);
  const [novoTipoLabel, setNovoTipoLabel] = useState("");

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

  function countByTipo(slug: string) {
    return upcoming.filter((r) => r.tipo === slug).length;
  }

  function tipoLabel(slug: string) {
    return tipos.find((t) => t.slug === slug)?.label ?? slug;
  }

  function openTiposEditor() {
    setTiposDraft(tipos.length ? [...tipos] : []);
    setEditingTipos(true);
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
    setTiposDraft((prev) => [...prev, { slug, label }]);
    setNovoTipoLabel("");
  }

  async function removeReserva(id: string) {
    if (!confirm("Excluir esta reserva?")) return;
    await fetch(`/api/pousada/reservas/${id}`, { method: "DELETE" });
    setReservas((prev) => prev.filter((r) => r.id !== id));
  }

  if (loading) {
    return <div className="p-8 text-sm text-slate-400">Carregando...</div>;
  }

  return (
    <div className="p-6 md:p-8 space-y-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-xl font-semibold text-slate-900 flex items-center gap-2">🏡 Pousada</h1>
        <div className="flex items-center gap-2">
          <Link
            href={role === "manager" ? `/gestor/${clientId}/pousada/relatorios` : "/cliente/pousada/relatorios"}
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-600 hover:bg-slate-50"
          >
            📊 Relatórios
          </Link>
          <button
            onClick={openTiposEditor}
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-600 hover:bg-slate-50"
          >
            ⚙️ Tipos de reserva
          </button>
          <button
            onClick={() => setModal("new")}
            className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-700"
          >
            + Nova reserva
          </button>
        </div>
      </div>

      {editingTipos && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 space-y-3">
          <p className="text-sm font-medium text-amber-900">Tipos de reserva</p>
          <div className="space-y-2">
            {tiposDraft.map((t, i) => (
              <div key={t.slug} className="flex items-center gap-2">
                <input
                  value={t.label}
                  onChange={(e) => setTiposDraft((prev) => prev.map((x, idx) => (idx === i ? { ...x, label: e.target.value } : x)))}
                  className="flex-1 rounded-lg border border-slate-200 px-3 py-1.5 text-sm outline-none focus:border-amber-400"
                />
                <span className="text-xs text-slate-400 w-28 truncate">{t.slug}</span>
                <button onClick={() => setTiposDraft((prev) => prev.filter((_, idx) => idx !== i))} className="text-slate-400 hover:text-red-500 text-lg leading-none">×</button>
              </div>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <input
              value={novoTipoLabel}
              onChange={(e) => setNovoTipoLabel(e.target.value)}
              placeholder="Novo tipo, ex: Dia das Mães"
              className="flex-1 rounded-lg border border-slate-200 px-3 py-1.5 text-sm outline-none focus:border-amber-400"
            />
            <button onClick={addTipoDraft} className="rounded-lg border border-amber-300 px-3 py-1.5 text-sm text-amber-800 hover:bg-amber-100">
              Adicionar
            </button>
          </div>
          <div className="flex gap-2 pt-1">
            <button onClick={() => setEditingTipos(false)} className="text-sm text-slate-500 hover:text-slate-700 px-3 py-1.5">Cancelar</button>
            <button onClick={saveTipos} className="rounded-lg bg-amber-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-amber-700">Salvar</button>
          </div>
        </div>
      )}

      {/* Cards por tipo */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
        {tipos.map((t) => (
          <div key={t.slug} className="rounded-xl border border-slate-200 bg-white p-4">
            <p className="text-xs text-slate-400">{t.label}</p>
            <p className="text-2xl font-semibold text-slate-900">{countByTipo(t.slug)}</p>
            <p className="text-xs text-slate-400">próximas reservas</p>
          </div>
        ))}
        {tipos.length === 0 && (
          <p className="col-span-full text-sm text-slate-400">Nenhum tipo de reserva configurado ainda — clique em &quot;Tipos de reserva&quot; pra adicionar.</p>
        )}
      </div>

      {/* Tabela de próximas reservas */}
      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100">
          <p className="text-sm font-medium text-slate-700">Próximas reservas</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-400 border-b border-slate-100">
                <th className="px-4 py-2">Data</th>
                <th className="px-4 py-2">Tipo</th>
                <th className="px-4 py-2">Responsável</th>
                <th className="px-4 py-2">Pessoas</th>
                <th className="px-4 py-2">Valor</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {upcoming.map((r) => (
                <tr key={r.id} className="border-b border-slate-50 hover:bg-slate-50">
                  <td className="px-4 py-2 whitespace-nowrap">{new Date(r.data + "T00:00:00").toLocaleDateString("pt-BR")}{r.hora ? ` ${r.hora}` : ""}</td>
                  <td className="px-4 py-2">{tipoLabel(r.tipo)}</td>
                  <td className="px-4 py-2">{r.responsavel.nome}</td>
                  <td className="px-4 py-2">{r.pessoas.length}</td>
                  <td className="px-4 py-2">{fmt(r.valorTotal)}</td>
                  <td className="px-4 py-2">
                    <span className={clsx("rounded-full px-2 py-0.5 text-xs font-medium", STATUS_BADGE[r.status])}>
                      {STATUS_LABEL[r.status]}
                    </span>
                    {r.origem === "ia" && <span className="ml-1 text-xs text-slate-400">🤖</span>}
                  </td>
                  <td className="px-4 py-2 text-right whitespace-nowrap">
                    <button onClick={() => setModal(r)} className="text-xs text-amber-700 hover:text-amber-800 mr-2">Editar</button>
                    {role === "manager" && (
                      <button onClick={() => removeReserva(r.id)} className="text-xs text-slate-400 hover:text-red-500">Excluir</button>
                    )}
                  </td>
                </tr>
              ))}
              {upcoming.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-6 text-center text-sm text-slate-400">Nenhuma reserva próxima.</td></tr>
              )}
            </tbody>
          </table>
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
  );
}
