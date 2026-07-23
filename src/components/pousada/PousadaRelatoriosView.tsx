"use client";

import { useEffect, useState, useCallback } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import type { Reserva, PousadaTipo, FaixaEtariaResumo } from "@/lib/pousada-types";
import { PousadaSubNav } from "./PousadaSubNav";

function fmt(v: number) {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function firstDayOfMonth(): string {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
}

export function PousadaRelatoriosView({ clientId, role }: { clientId: string; role: "manager" | "client" }) {
  const [tipos, setTipos] = useState<PousadaTipo[]>([]);
  const [tipo, setTipo] = useState("");
  const [from, setFrom] = useState(firstDayOfMonth());
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10));
  const [reservas, setReservas] = useState<Reserva[]>([]);
  const [faixas, setFaixas] = useState<FaixaEtariaResumo>({ faixa0a5: 0, faixa6a12: 0 });
  const [totais, setTotais] = useState({ valorTotal: 0, valorPago: 0, faltaPagar: 0 });
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const [tiposRes, relRes] = await Promise.all([
      fetch(`/api/pousada/tipos?clientId=${clientId}`).then((r) => r.json()),
      fetch(`/api/pousada/reservas?clientId=${clientId}&from=${from}&to=${to}${tipo ? `&tipo=${tipo}` : ""}`).then((r) => r.json()),
    ]);
    setTipos(Array.isArray(tiposRes) ? tiposRes : []);
    setReservas(relRes.reservas ?? []);
    setFaixas(relRes.faixasEtarias ?? { faixa0a5: 0, faixa6a12: 0 });
    setTotais(relRes.totais ?? { valorTotal: 0, valorPago: 0, faltaPagar: 0 });
    setLoading(false);
  }, [clientId, tipo, from, to]);

  useEffect(() => { load(); }, [load]);

  const chartData = [
    { faixa: "0-5 anos", quantidade: faixas.faixa0a5 },
    { faixa: "6-12 anos", quantidade: faixas.faixa6a12 },
  ];

  function tipoLabel(slug: string) {
    return tipos.find((t) => t.slug === slug)?.label ?? slug;
  }

  return (
    <div>
      <div className="print:hidden">
        <PousadaSubNav clientId={clientId} role={role} />
      </div>
      <div className="p-6 md:p-8 space-y-6 max-w-6xl mx-auto print:p-0 print:max-w-none">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">📊 Relatórios — Pousada</h1>
          <p className="text-sm text-slate-500 print:block hidden">
            Período: {new Date(from + "T00:00:00").toLocaleDateString("pt-BR")} a {new Date(to + "T00:00:00").toLocaleDateString("pt-BR")}
            {tipo ? ` · ${tipoLabel(tipo)}` : ""}
          </p>
        </div>
        <button
          onClick={() => window.print()}
          className="print:hidden rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm text-slate-600 hover:bg-slate-50"
        >
          🖨️ Baixar / Imprimir PDF
        </button>
      </div>

      <div className="print:hidden flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4">
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
        <div>
          <label className="text-xs font-medium text-slate-600 block mb-1">Tipo</label>
          <select value={tipo} onChange={(e) => setTipo(e.target.value)}
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-amber-400 bg-white">
            <option value="">Todos</option>
            {tipos.map((t) => <option key={t.slug} value={t.slug}>{t.label}</option>)}
          </select>
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-slate-400">Carregando...</p>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <p className="text-xs text-slate-400">Reservas no período</p>
              <p className="text-2xl font-semibold text-slate-900">{reservas.length}</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <p className="text-xs text-slate-400">Valor total</p>
              <p className="text-2xl font-semibold text-slate-900">{fmt(totais.valorTotal)}</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <p className="text-xs text-slate-400">Valor pago</p>
              <p className="text-2xl font-semibold text-green-600">{fmt(totais.valorPago)}</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <p className="text-xs text-slate-400">Falta pagar</p>
              <p className="text-2xl font-semibold text-amber-600">{fmt(totais.faltaPagar)}</p>
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <p className="text-sm font-medium text-slate-700 mb-3">Crianças por faixa etária</p>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="faixa" tick={{ fontSize: 12 }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                  <Tooltip />
                  <Bar dataKey="quantidade" fill="#f59e0b" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
            <p className="text-sm font-medium text-slate-700 px-4 pt-4 pb-2">Reservas no período ({reservas.length})</p>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-400 border-b border-slate-100">
                  <th className="px-4 py-2">Data</th>
                  <th className="px-4 py-2">Tipo</th>
                  <th className="px-4 py-2">Responsável</th>
                  <th className="px-4 py-2">Pessoas</th>
                  <th className="px-4 py-2">Valor</th>
                  <th className="px-4 py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {reservas.map((r) => (
                  <tr key={r.id} className="border-b border-slate-50">
                    <td className="px-4 py-2 whitespace-nowrap">{new Date(r.data + "T00:00:00").toLocaleDateString("pt-BR")}</td>
                    <td className="px-4 py-2">{tipoLabel(r.tipo)}</td>
                    <td className="px-4 py-2">{r.responsavel.nome}</td>
                    <td className="px-4 py-2">{r.pessoas.length}</td>
                    <td className="px-4 py-2">{fmt(r.valorTotal)}</td>
                    <td className="px-4 py-2 capitalize">{r.status}</td>
                  </tr>
                ))}
                {reservas.length === 0 && (
                  <tr><td colSpan={6} className="px-4 py-6 text-center text-slate-400">Nenhuma reserva no período.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
      </div>
    </div>
  );
}
