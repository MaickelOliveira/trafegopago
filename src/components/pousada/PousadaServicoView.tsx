"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { clsx } from "clsx";
import type { Reserva, PousadaTipo, FaixaEtariaResumo } from "@/lib/pousada-types";
import { PousadaSubNav } from "./PousadaSubNav";
import { ReservaModal } from "./ReservaModal";

function fmt(v: number) {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function fmtData(iso?: string) {
  if (!iso) return "—";
  return new Date(iso + "T00:00:00").toLocaleDateString("pt-BR");
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

export function PousadaServicoView({
  clientId,
  tipoSlug,
  role,
}: {
  clientId: string;
  tipoSlug: string;
  role: "manager" | "client";
}) {
  const router = useRouter();
  const [tipos, setTipos] = useState<PousadaTipo[]>([]);
  const [reservas, setReservas] = useState<Reserva[]>([]);
  const [faixas, setFaixas] = useState<FaixaEtariaResumo>({ faixa0a5: 0, faixa6a12: 0 });
  const [totais, setTotais] = useState({ valorTotal: 0, valorPago: 0, faltaPagar: 0 });
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState<"new" | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ clientId, tipo: tipoSlug });
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    const [tiposRes, relRes] = await Promise.all([
      fetch(`/api/pousada/tipos?clientId=${clientId}`).then((r) => r.json()),
      fetch(`/api/pousada/reservas?${params.toString()}`).then((r) => r.json()),
    ]);
    setTipos(Array.isArray(tiposRes) ? tiposRes : []);
    setReservas(relRes.reservas ?? []);
    setFaixas(relRes.faixasEtarias ?? { faixa0a5: 0, faixa6a12: 0 });
    setTotais(relRes.totais ?? { valorTotal: 0, valorPago: 0, faltaPagar: 0 });
    setLoading(false);
  }, [clientId, tipoSlug, from, to]);

  useEffect(() => { load(); }, [load]);

  const tipoInfo = tipos.find((t) => t.slug === tipoSlug);
  const isHospedagem = (tipoInfo?.categoria ?? "evento") === "hospedagem";
  const base = role === "manager" ? `/gestor/${clientId}/pousada` : "/cliente/pousada";

  return (
    <div>
      <PousadaSubNav clientId={clientId} role={role} />
      <div className="p-6 md:p-10 space-y-8 max-w-5xl mx-auto">
        <Link href={base} className="text-sm text-slate-500 hover:text-slate-700 flex items-center gap-1">
          ← Voltar ao dashboard
        </Link>

        <div className="flex items-center justify-between flex-wrap gap-3">
          <h1 className="text-2xl font-semibold text-slate-900 flex items-center gap-2">
            {isHospedagem ? "🛏️" : "🎉"} {tipoInfo?.label ?? tipoSlug}
          </h1>
          <button
            onClick={() => setModal("new")}
            className="rounded-lg bg-amber-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-amber-700"
          >
            + Nova reserva
          </button>
        </div>

        {/* Filtro de datas */}
        <div className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4">
          <div>
            <label className="text-xs font-medium text-slate-600 block mb-1">De</label>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
              className="rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-amber-400" />
          </div>
          <div>
            <label className="text-xs font-medium text-slate-600 block mb-1">Até</label>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)}
              className="rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-amber-400" />
          </div>
          {(from || to) && (
            <button onClick={() => { setFrom(""); setTo(""); }} className="text-sm text-slate-500 hover:text-slate-700 px-2 py-2">
              Limpar filtro
            </button>
          )}
          <span className="ml-auto text-sm text-slate-400">{reservas.length} reserva{reservas.length === 1 ? "" : "s"}</span>
        </div>

        {/* Resumo */}
        <div className={clsx("grid gap-4", isHospedagem ? "grid-cols-2 sm:grid-cols-3" : "grid-cols-2 sm:grid-cols-5")}>
          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <p className="text-xs uppercase tracking-wide text-slate-400">Valor total</p>
            <p className="text-xl font-semibold text-slate-900 mt-1">{fmt(totais.valorTotal)}</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <p className="text-xs uppercase tracking-wide text-slate-400">Valor pago</p>
            <p className="text-xl font-semibold text-green-600 mt-1">{fmt(totais.valorPago)}</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <p className="text-xs uppercase tracking-wide text-slate-400">Falta pagar</p>
            <p className="text-xl font-semibold text-amber-600 mt-1">{fmt(totais.faltaPagar)}</p>
          </div>
          {!isHospedagem && (
            <>
              <div className="rounded-2xl border border-slate-200 bg-white p-4">
                <p className="text-xs uppercase tracking-wide text-slate-400">Crianças 0-5</p>
                <p className="text-xl font-semibold text-slate-900 mt-1">{faixas.faixa0a5}</p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-white p-4">
                <p className="text-xs uppercase tracking-wide text-slate-400">Crianças 6-12</p>
                <p className="text-xl font-semibold text-slate-900 mt-1">{faixas.faixa6a12}</p>
              </div>
            </>
          )}
        </div>

        {/* Lista de reservas */}
        <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
          {loading ? (
            <p className="p-5 text-sm text-slate-400">Carregando...</p>
          ) : reservas.length === 0 ? (
            <p className="p-5 text-sm text-slate-400">Nenhuma reserva encontrada.</p>
          ) : (
            <div className="divide-y divide-slate-50">
              {reservas.map((r) => (
                <div
                  key={r.id}
                  onClick={() => router.push(`${base}/reservas/${r.id}`)}
                  className="px-5 py-4 flex flex-wrap items-center gap-x-4 gap-y-2 cursor-pointer hover:bg-slate-50"
                >
                  <div className="w-36 shrink-0">
                    <p className="text-sm text-slate-700">
                      {isHospedagem && r.dataCheckout ? `${fmtData(r.data)} → ${fmtData(r.dataCheckout)}` : fmtData(r.data)}
                    </p>
                    <p className="text-xs text-slate-400">Reservado em {fmtData(r.createdAt.slice(0, 10))}</p>
                  </div>
                  <div className="flex-1 min-w-[160px]">
                    <p className="text-sm font-medium text-slate-800">{r.responsavel.nome}</p>
                    <p className="text-xs text-slate-400">
                      {isHospedagem ? (
                        <>{r.quarto ? `Quarto/Chalé ${r.quarto} · ` : ""}{r.pessoas.length} hóspede{r.pessoas.length === 1 ? "" : "s"}</>
                      ) : (
                        <>{r.pessoas.length} pessoa{r.pessoas.length === 1 ? "" : "s"}{r.cidade ? ` · ${r.cidade}` : ""}</>
                      )}
                    </p>
                  </div>
                  <span className="text-sm text-slate-600 w-24 shrink-0">{fmt(r.valorTotal)}</span>
                  <span className={clsx("rounded-full px-2.5 py-1 text-xs font-medium shrink-0", STATUS_BADGE[r.status])}>
                    {STATUS_LABEL[r.status]}
                    {r.origem === "ia" && " · 🤖"}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {modal && (
        <ReservaModal
          clientId={clientId}
          tipos={tipos}
          initial={null}
          defaultTipo={tipoSlug}
          onSave={() => load()}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  );
}
