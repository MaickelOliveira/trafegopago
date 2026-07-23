"use client";

import { useEffect, useState, useCallback } from "react";
import { clsx } from "clsx";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import type { Reserva, PousadaTipo, FaixaEtariaResumo } from "@/lib/pousada-types";
import { PousadaSubNav } from "./PousadaSubNav";

function fmt(v: number) {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function fmtData(iso?: string) {
  if (!iso) return "—";
  return new Date(iso + "T00:00:00").toLocaleDateString("pt-BR");
}

function fmtDataHora(iso?: string) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("pt-BR");
}

function firstDayOfMonth(): string {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
}

// Conta crianças por faixa etária DESTA reserva (não do agregado) — cada
// linha da tabela-planilha mostra sua própria contagem, igual a planilha
// antiga tinha por linha.
function faixasDaReserva(r: Reserva): { f05: number; f612: number } {
  let f05 = 0, f612 = 0;
  for (const p of r.pessoas) {
    if (typeof p.idade !== "number") continue;
    if (p.idade <= 5) f05++;
    else if (p.idade <= 12) f612++;
  }
  return { f05, f612 };
}

// Reconstrói o texto "Nome (XX anos) - R$XX,00, Nome2..." igual a coluna
// "Pessoas" da planilha antiga.
function pessoasTexto(r: Reserva): string {
  return r.pessoas
    .map((p) => {
      const idadeStr = typeof p.idade === "number" ? ` (${p.idade} anos)` : "";
      const valorStr = p.gratuito ? "Gratuito" : fmt(p.valor);
      return `${p.nome}${idadeStr} - ${valorStr}`;
    })
    .join(", ");
}

const TH = "px-2 py-1.5 border border-slate-200 whitespace-nowrap";
const TD = "px-2 py-1.5 border border-slate-200 align-top";

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

  // Agrupa as reservas por tipo, na mesma ordem de "tipos" — cada grupo vira
  // uma tabela com as colunas certas pra sua categoria, igual as abas da
  // planilha antiga (uma aba por produto, cada uma com suas colunas).
  const gruposPorTipo = new Map<string, Reserva[]>();
  for (const r of reservas) {
    const arr = gruposPorTipo.get(r.tipo) ?? [];
    arr.push(r);
    gruposPorTipo.set(r.tipo, arr);
  }
  const gruposOrdenados = tipos.filter((t) => gruposPorTipo.has(t.slug));

  function tipoLabel(slug: string) {
    return tipos.find((t) => t.slug === slug)?.label ?? slug;
  }

  return (
    <div>
      <PousadaSubNav clientId={clientId} role={role} />
      <div className="p-6 md:p-8 space-y-6 max-w-6xl mx-auto">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <h1 className="text-xl font-semibold text-slate-900">📊 Relatórios — Pousada</h1>
          <button
            onClick={() => window.print()}
            className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm text-slate-600 hover:bg-slate-50"
          >
            🖨️ Baixar / Imprimir PDF
          </button>
        </div>

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
          // .print-area — SOMENTE este bloco aparece ao imprimir/gerar PDF
          // (ver globals.css); tudo fora dele (menu, filtros, botão) some.
          <div className="print-area space-y-6">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">Relatório de reservas — Pousada</h2>
              <p className="text-sm text-slate-500">
                Período: {fmtData(from)} a {fmtData(to)}
                {tipo ? ` · ${tipoLabel(tipo)}` : " · Todos os tipos"}
              </p>
            </div>

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

            {/* Uma tabela por tipo, com as colunas da planilha original */}
            {gruposOrdenados.length === 0 && (
              <p className="text-sm text-slate-400 text-center py-6">Nenhuma reserva no período.</p>
            )}
            {gruposOrdenados.map((t) => {
              const rows = gruposPorTipo.get(t.slug)!;
              const hospedagem = t.categoria === "hospedagem";
              return (
                <div key={t.slug} className="rounded-xl border border-slate-200 bg-white overflow-hidden">
                  <p className="text-sm font-medium text-slate-700 px-4 pt-4 pb-2">
                    {hospedagem ? "🛏️" : "🎉"} {t.label} ({rows.length})
                  </p>
                  <div className="overflow-x-auto px-4 pb-4">
                    <table className="border-collapse text-xs">
                      <thead>
                        <tr className="bg-slate-50 text-slate-500 text-left">
                          <th className={TH}>Nº</th>
                          <th className={TH}>Reservado em</th>
                          {hospedagem ? (
                            <>
                              <th className={TH}>Check-in</th>
                              <th className={TH}>Check-out</th>
                              <th className={TH}>Responsável</th>
                              <th className={TH}>Telefone</th>
                              <th className={TH}>Qtd. Pessoas</th>
                              <th className={TH}>Quarto/Chalé</th>
                              <th className={TH}>Valor Total</th>
                              <th className={TH}>Valor Pago</th>
                              <th className={TH}>Falta Pagar</th>
                              <th className={TH}>CPF</th>
                              <th className={TH}>Status</th>
                            </>
                          ) : (
                            <>
                              <th className={TH}>Data</th>
                              <th className={TH}>Responsável</th>
                              <th className={TH}>Pessoas</th>
                              <th className={TH}>0-5 anos</th>
                              <th className={TH}>6-12 anos</th>
                              <th className={TH}>Telefone</th>
                              <th className={TH}>Qtd. Pessoas</th>
                              <th className={TH}>Valor Total</th>
                              <th className={TH}>Valor Pago</th>
                              <th className={TH}>Falta Pagar</th>
                              <th className={TH}>Status</th>
                              <th className={TH}>Cidade</th>
                              <th className={TH}>Observações</th>
                            </>
                          )}
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((r, i) => {
                          const { f05, f612 } = faixasDaReserva(r);
                          return (
                            <tr key={r.id}>
                              <td className={TD}>{i + 1}</td>
                              <td className={clsx(TD, "whitespace-nowrap")}>{fmtDataHora(r.createdAt)}</td>
                              {hospedagem ? (
                                <>
                                  <td className={clsx(TD, "whitespace-nowrap")}>{fmtData(r.data)}</td>
                                  <td className={clsx(TD, "whitespace-nowrap")}>{fmtData(r.dataCheckout)}</td>
                                  <td className={TD}>{r.responsavel.nome}</td>
                                  <td className={TD}>{r.telefone ?? "—"}</td>
                                  <td className={TD}>{r.pessoas.length}</td>
                                  <td className={TD}>{r.quarto ?? "—"}</td>
                                  <td className={TD}>{fmt(r.valorTotal)}</td>
                                  <td className={TD}>{fmt(r.valorPago)}</td>
                                  <td className={TD}>{fmt(r.faltaPagar)}</td>
                                  <td className={TD}>{r.responsavel.cpf ?? "—"}</td>
                                  <td className={clsx(TD, "capitalize")}>{r.status}</td>
                                </>
                              ) : (
                                <>
                                  <td className={clsx(TD, "whitespace-nowrap")}>{fmtData(r.data)}</td>
                                  <td className={TD}>{r.responsavel.nome}</td>
                                  <td className={clsx(TD, "max-w-xs")}>{pessoasTexto(r)}</td>
                                  <td className={clsx(TD, "text-center")}>{f05}</td>
                                  <td className={clsx(TD, "text-center")}>{f612}</td>
                                  <td className={TD}>{r.telefone ?? "—"}</td>
                                  <td className={TD}>{r.pessoas.length}</td>
                                  <td className={TD}>{fmt(r.valorTotal)}</td>
                                  <td className={TD}>{fmt(r.valorPago)}</td>
                                  <td className={TD}>{fmt(r.faltaPagar)}</td>
                                  <td className={clsx(TD, "capitalize")}>{r.status}</td>
                                  <td className={TD}>{r.cidade ?? "—"}</td>
                                  <td className={TD}>{r.observacoes ?? "—"}</td>
                                </>
                              )}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
