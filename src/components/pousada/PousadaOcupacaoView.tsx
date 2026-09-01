"use client";

import { useEffect, useState, useCallback } from "react";
import { clsx } from "clsx";
import type { Reserva } from "@/lib/pousada-types";
import { formatDataComDiaSemana } from "@/lib/format-date";
import { PousadaSubNav } from "./PousadaSubNav";

type Ocupado = { quarto: string; reserva: Reserva };

function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// Próxima ocorrência de um dia da semana (0=domingo..6=sábado) a partir de hoje,
// incluindo hoje se já cair nesse dia.
function proximoDiaSemana(diaSemana: number): string {
  const hoje = new Date();
  const diff = (diaSemana - hoje.getDay() + 7) % 7;
  const alvo = new Date(hoje);
  alvo.setDate(hoje.getDate() + diff);
  return toISODate(alvo);
}

const DATAS_RAPIDAS: { label: string; value: () => string }[] = [
  { label: "Hoje", value: () => toISODate(new Date()) },
  { label: "Amanhã", value: () => toISODate(new Date(Date.now() + 86400000)) },
  { label: "Próximo sábado", value: () => proximoDiaSemana(6) },
  { label: "Próximo domingo", value: () => proximoDiaSemana(0) },
];

export function PousadaOcupacaoView({ clientId, role }: { clientId: string; role: "manager" | "client" }) {
  const [modo, setModo] = useState<"dia" | "periodo">("dia");
  const [data, setData] = useState(new Date().toISOString().slice(0, 10));
  // Só usado no modo "período" — quando vazio, cai no próprio `data` (1 dia só).
  const [dataFim, setDataFim] = useState("");
  const [totalQuartos, setTotalQuartos] = useState(0);
  const [ocupados, setOcupados] = useState<Ocupado[]>([]);
  const [loading, setLoading] = useState(true);
  const [selecionado, setSelecionado] = useState<Ocupado | null>(null);
  const [editandoTotal, setEditandoTotal] = useState(false);
  const [totalDraft, setTotalDraft] = useState("0");

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ clientId, data });
    // No modo "por período", manda dataFim mesmo que ainda igual a `data`
    // (intervalo de 1 dia) — a API só ativa a checagem por período quando
    // esse parâmetro está presente.
    if (modo === "periodo") params.set("dataFim", dataFim || data);
    const res = await fetch(`/api/pousada/ocupacao?${params}`).then((r) => r.json());
    setTotalQuartos(res.totalQuartos ?? 0);
    setOcupados(res.ocupados ?? []);
    setTotalDraft(String(res.totalQuartos ?? 0));
    setLoading(false);
  }, [clientId, data, dataFim, modo]);

  useEffect(() => { load(); }, [load]);

  async function salvarTotal() {
    const n = Number(totalDraft);
    if (!Number.isFinite(n) || n < 0) return;
    await fetch("/api/pousada/config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientId, totalQuartos: n }),
    });
    setTotalQuartos(n);
    setEditandoTotal(false);
  }

  const ocupacaoPorQuarto = new Map(ocupados.map((o) => [o.quarto, o.reserva]));
  const quartos = Array.from({ length: totalQuartos }, (_, i) => String(i + 1));

  return (
    <div>
      <PousadaSubNav clientId={clientId} role={role} />
      <div className="p-6 md:p-8 space-y-6 max-w-5xl mx-auto">
      <div>
        <h1 className="text-xl font-semibold text-slate-900 flex items-center gap-2">🛏️ Mapa de ocupação</h1>
        <p className="text-sm text-slate-500 mt-1">
          {modo === "dia"
            ? "Veja quais quartos/chalés estão ocupados em uma data específica."
            : "Veja quais quartos/chalés têm alguma reserva em QUALQUER dia do período — útil pra saber disponibilidade de uma estadia de várias diárias."}
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex rounded-lg border border-slate-200 p-0.5">
          {(["dia", "periodo"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setModo(m)}
              className={clsx(
                "rounded-md px-3 py-1.5 text-xs font-medium transition",
                modo === m ? "bg-amber-600 text-white" : "text-slate-600 hover:bg-slate-50"
              )}
            >
              {m === "dia" ? "Por dia" : "Por período"}
            </button>
          ))}
        </div>
        <div>
          <label className="text-xs font-medium text-slate-600 block mb-1">{modo === "dia" ? "Data" : "De"}</label>
          <input type="date" value={data} onChange={(e) => setData(e.target.value)}
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-amber-400" />
        </div>
        {modo === "periodo" && (
          <div>
            <label className="text-xs font-medium text-slate-600 block mb-1">Até</label>
            <input type="date" value={dataFim} min={data} onChange={(e) => setDataFim(e.target.value)}
              className="rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-amber-400" />
          </div>
        )}
        {modo === "dia" && (
          <div className="flex flex-wrap gap-1.5">
            {DATAS_RAPIDAS.map((d) => {
              const v = d.value();
              const ativo = v === data;
              return (
                <button
                  key={d.label}
                  type="button"
                  onClick={() => setData(v)}
                  className={clsx(
                    "rounded-lg px-3 py-2 text-xs font-medium border transition",
                    ativo
                      ? "bg-amber-600 border-amber-600 text-white"
                      : "border-slate-200 text-slate-600 hover:bg-slate-50"
                  )}
                >
                  {d.label}
                </button>
              );
            })}
          </div>
        )}
        <div className="flex-1" />
        {role === "manager" && (
          editandoTotal ? (
            <div className="flex items-end gap-2">
              <div>
                <label className="text-xs font-medium text-slate-600 block mb-1">Total de quartos/chalés</label>
                <input type="number" min="0" value={totalDraft} onChange={(e) => setTotalDraft(e.target.value)}
                  className="w-28 rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-amber-400" />
              </div>
              <button onClick={salvarTotal} className="rounded-lg bg-amber-600 px-3 py-2 text-sm font-semibold text-white hover:bg-amber-700">Salvar</button>
              <button onClick={() => setEditandoTotal(false)} className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-600 hover:bg-slate-50">Cancelar</button>
            </div>
          ) : (
            <button onClick={() => setEditandoTotal(true)} className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-600 hover:bg-slate-50">
              ⚙️ {totalQuartos} quartos/chalés cadastrados
            </button>
          )
        )}
      </div>

      {loading ? (
        <p className="text-sm text-slate-400">Carregando...</p>
      ) : totalQuartos === 0 ? (
        <p className="text-sm text-slate-400">
          Nenhum quarto/chalé cadastrado ainda{role === "manager" ? " — clique no botão acima pra configurar o total." : "."}
        </p>
      ) : (
        <>
          <div className="flex items-center gap-4 text-xs text-slate-500">
            <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded bg-green-400 inline-block" /> Livre</span>
            <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded bg-red-400 inline-block" /> Ocupado</span>
            <span className="ml-auto">{ocupacaoPorQuarto.size} de {totalQuartos} ocupados</span>
          </div>

          <div className="grid grid-cols-6 sm:grid-cols-8 md:grid-cols-10 gap-2">
            {quartos.map((q) => {
              const reserva = ocupacaoPorQuarto.get(q);
              return (
                <button
                  key={q}
                  onClick={() => reserva && setSelecionado({ quarto: q, reserva })}
                  className={clsx(
                    "rounded-lg py-3 text-sm font-semibold text-center transition",
                    reserva
                      ? "bg-red-100 text-red-700 hover:bg-red-200 cursor-pointer"
                      : "bg-green-50 text-green-700 cursor-default"
                  )}
                >
                  {q}
                </button>
              );
            })}
          </div>
        </>
      )}

      {selecionado && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setSelecionado(null)}>
          <div className="w-full max-w-sm rounded-2xl bg-white shadow-2xl p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-semibold text-slate-900">Quarto/Chalé {selecionado.quarto}</h2>
              <button onClick={() => setSelecionado(null)} className="text-slate-400 hover:text-slate-600 text-xl leading-none">×</button>
            </div>
            <div className="space-y-1.5 text-sm">
              <p><span className="text-slate-400">Responsável:</span> {selecionado.reserva.responsavel.nome}</p>
              <p><span className="text-slate-400">Check-in:</span> {formatDataComDiaSemana(selecionado.reserva.data)}</p>
              <p><span className="text-slate-400">Check-out:</span> {formatDataComDiaSemana(selecionado.reserva.dataCheckout)}</p>
              <p><span className="text-slate-400">Status:</span> {selecionado.reserva.status}</p>
            </div>
            <div className="mt-3 pt-3 border-t border-slate-100">
              <p className="text-xs font-medium text-slate-500 mb-2">Hóspedes ({selecionado.reserva.pessoas.length})</p>
              <div className="space-y-2 max-h-60 overflow-y-auto">
                {selecionado.reserva.pessoas.map((p, i) => (
                  <div key={i} className="rounded-lg bg-slate-50 px-3 py-2 text-sm">
                    <p className="font-medium text-slate-800">{p.nome}</p>
                    <p className="text-xs text-slate-500">
                      {[
                        p.cpf ? `CPF: ${p.cpf}` : null,
                        typeof p.idade === "number" ? `${p.idade} anos` : null,
                        p.telefone ? `Tel: ${p.telefone}` : null,
                      ].filter(Boolean).join(" · ") || "—"}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
      </div>
    </div>
  );
}
