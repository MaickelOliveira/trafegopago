"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { clsx } from "clsx";
import type { Reserva, PousadaTipo, CategoriaTipo } from "@/lib/pousada-types";
import { ReservaModal } from "./ReservaModal";
import { PousadaSubNav } from "./PousadaSubNav";

function fmt(v: number) {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function fmtData(iso: string) {
  return new Date(iso + "T00:00:00").toLocaleDateString("pt-BR");
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
  const router = useRouter();
  const [tipos, setTipos] = useState<PousadaTipo[]>([]);
  const [reservas, setReservas] = useState<Reserva[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState<"new" | Reserva | null>(null);
  const [editingTipos, setEditingTipos] = useState(false);
  const [tiposDraft, setTiposDraft] = useState<PousadaTipo[]>([]);
  const [novoTipoLabel, setNovoTipoLabel] = useState("");
  const [novoTipoCategoria, setNovoTipoCategoria] = useState<CategoriaTipo>("evento");
  const [tipoAberto, setTipoAberto] = useState<string | null>(null);

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

  async function removeReserva(id: string) {
    if (!confirm("Excluir esta reserva?")) return;
    await fetch(`/api/pousada/reservas/${id}`, { method: "DELETE" });
    setReservas((prev) => prev.filter((r) => r.id !== id));
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

      {/* Uma seção por tipo de reserva */}
      <div className="space-y-4">
        <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wide">Por tipo de reserva</h2>
        {tipos.length === 0 && (
          <p className="text-sm text-slate-400">Nenhum tipo de reserva configurado ainda — clique em &quot;Tipos de reserva&quot; acima pra adicionar.</p>
        )}
        {tipos.map((t) => {
          const lista = reservasDoTipo(t.slug);
          const aberto = tipoAberto === t.slug;
          const categoria = categoriaDoTipo(t.slug);
          return (
            <div key={t.slug} className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
              <button
                onClick={() => setTipoAberto(aberto ? null : t.slug)}
                className="w-full flex items-center justify-between px-5 py-4 hover:bg-slate-50"
              >
                <span className="font-medium text-slate-800 flex items-center gap-2">
                  {categoria === "hospedagem" ? "🛏️" : "🎉"} {t.label}
                </span>
                <span className="flex items-center gap-3">
                  <span className="text-sm text-slate-400">{lista.length} próxima{lista.length === 1 ? "" : "s"}</span>
                  <span className="text-slate-300">{aberto ? "▲" : "▼"}</span>
                </span>
              </button>

              {aberto && (
                <div className="border-t border-slate-100 divide-y divide-slate-50">
                  {lista.length === 0 && (
                    <p className="px-5 py-4 text-sm text-slate-400">Nenhuma reserva próxima desse tipo.</p>
                  )}
                  {lista.map((r) => (
                    <div
                      key={r.id}
                      onClick={() => router.push(`${role === "manager" ? `/gestor/${clientId}/pousada` : "/cliente/pousada"}/reservas/${r.id}`)}
                      className="px-5 py-4 flex flex-wrap items-center gap-x-4 gap-y-2 cursor-pointer hover:bg-slate-50"
                    >
                      <div className="w-32 text-sm text-slate-500 shrink-0">
                        {categoria === "hospedagem" && r.dataCheckout
                          ? `${fmtData(r.data)} → ${fmtData(r.dataCheckout)}`
                          : fmtData(r.data)}
                      </div>
                      <div className="flex-1 min-w-[160px]">
                        <p className="text-sm font-medium text-slate-800">{r.responsavel.nome}</p>
                        <p className="text-xs text-slate-400">
                          {categoria === "hospedagem" ? (
                            <>
                              {r.quarto ? `Quarto/Chalé ${r.quarto} · ` : ""}
                              {r.pessoas.length} hóspede{r.pessoas.length === 1 ? "" : "s"}
                              {r.telefone ? ` · ${r.telefone}` : ""}
                            </>
                          ) : (
                            <>
                              {r.pessoas.length} pessoa{r.pessoas.length === 1 ? "" : "s"}
                              {r.cidade ? ` · ${r.cidade}` : ""}
                            </>
                          )}
                        </p>
                      </div>
                      <span className="text-sm text-slate-600 w-24 shrink-0">{fmt(r.valorTotal)}</span>
                      <span className={clsx("rounded-full px-2.5 py-1 text-xs font-medium shrink-0", STATUS_BADGE[r.status])}>
                        {STATUS_LABEL[r.status]}
                        {r.origem === "ia" && " · 🤖"}
                      </span>
                      <div className="flex gap-2 shrink-0">
                        <button onClick={(e) => { e.stopPropagation(); setModal(r); }} className="text-xs text-amber-700 hover:text-amber-800">Editar</button>
                        {role === "manager" && (
                          <button onClick={(e) => { e.stopPropagation(); removeReserva(r.id); }} className="text-xs text-slate-400 hover:text-red-500">Excluir</button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
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
