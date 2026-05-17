"use client";

import { useState, useEffect } from "react";
import { clsx } from "clsx";
import type { Transacao } from "@/lib/financeiro-types";
import { CATEGORIAS_RECEITA, CATEGORIAS_DESPESA } from "@/lib/financeiro-types";

type Client = { id: string; name: string; color: string };
type TipoFixo = "receita" | "despesa";

const MESES = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];
const DIAS_SEMANA = ["Dom","Seg","Ter","Qua","Qui","Sex","Sáb"];

function fmt(v: number) {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function fmtShort(v: number) {
  if (v >= 1000) return `R$${(v / 1000).toFixed(1)}k`;
  return `R$${v.toFixed(0)}`;
}

function daysInMonth(ano: number, mes: number) {
  return new Date(ano, mes, 0).getDate();
}

function firstWeekday(ano: number, mes: number) {
  return new Date(ano, mes - 1, 1).getDay();
}

// ── Modal de nova transação ──────────────────────────────────────────────────
function NovaTransacaoModal({
  tipo, dataInicial, clients, onSave, onClose,
}: {
  tipo: TipoFixo;
  dataInicial: string;
  clients: Client[];
  onSave: (t: Transacao) => void;
  onClose: () => void;
}) {
  const categorias = tipo === "receita" ? CATEGORIAS_RECEITA : CATEGORIAS_DESPESA;
  const [form, setForm] = useState({
    descricao: "", valor: "", categoria: "", clientId: "",
    recorrente: false, diaVencimento: "", status: "pago",
    data: dataInicial,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    if (!form.descricao || !form.valor || !form.categoria) {
      setError("Preencha descrição, valor e categoria.");
      return;
    }
    setSaving(true);
    const res = await fetch("/api/financeiro", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...form, tipo, valor: Number(form.valor) }),
    });
    const t = await res.json();
    if (res.ok) { onSave(t); onClose(); }
    else setError("Erro ao salvar.");
    setSaving(false);
  }

  const cor = tipo === "receita" ? "green" : "red";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className={clsx("rounded-t-2xl px-6 py-4 flex items-center justify-between",
          tipo === "receita" ? "bg-green-600" : "bg-red-500"
        )}>
          <div>
            <h2 className="font-semibold text-white">
              {tipo === "receita" ? "↑ Nova Receita" : "↓ Nova Despesa"}
            </h2>
            <p className="text-xs text-white/80 mt-0.5">
              {new Date(form.data + "T00:00:00").toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" })}
            </p>
          </div>
          <button onClick={onClose} className="text-white/80 hover:text-white text-2xl leading-none">×</button>
        </div>

        <div className="p-6 space-y-3">
          <div>
            <label className="text-xs font-medium text-slate-600 block mb-1">Descrição *</label>
            <input autoFocus value={form.descricao} onChange={(e) => setForm((f) => ({ ...f, descricao: e.target.value }))}
              placeholder={tipo === "receita" ? "Mensalidade SBcie" : "Assinatura UazAPI"}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-400" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-slate-600 block mb-1">Valor (R$) *</label>
              <input value={form.valor} onChange={(e) => setForm((f) => ({ ...f, valor: e.target.value }))}
                type="number" step="0.01" placeholder="0,00"
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-400" />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-600 block mb-1">Data</label>
              <input value={form.data} onChange={(e) => setForm((f) => ({ ...f, data: e.target.value }))}
                type="date"
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-400" />
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-slate-600 block mb-1">Categoria *</label>
            <select value={form.categoria} onChange={(e) => setForm((f) => ({ ...f, categoria: e.target.value }))}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-400 bg-white">
              <option value="">Selecionar</option>
              {categorias.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>

          {tipo === "receita" && (
            <div>
              <label className="text-xs font-medium text-slate-600 block mb-1">Cliente</label>
              <select value={form.clientId} onChange={(e) => setForm((f) => ({ ...f, clientId: e.target.value }))}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-400 bg-white">
                <option value="">Sem cliente</option>
                {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-slate-600 block mb-1">Status</label>
              <select value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-400 bg-white">
                <option value="pago">Pago</option>
                <option value="pendente">Pendente</option>
                <option value="atrasado">Atrasado</option>
              </select>
            </div>
            <div className="flex items-end pb-1">
              <label className="flex items-center gap-2 cursor-pointer text-sm text-slate-700">
                <input type="checkbox" checked={form.recorrente}
                  onChange={(e) => setForm((f) => ({ ...f, recorrente: e.target.checked }))}
                  className="h-4 w-4 rounded accent-blue-600" />
                Recorrente
              </label>
            </div>
          </div>

          {error && <p className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-600">{error}</p>}
        </div>

        <div className="flex gap-3 border-t border-slate-100 px-6 py-4">
          <button onClick={onClose} className="flex-1 rounded-lg border border-slate-200 py-2.5 text-sm text-slate-600 hover:bg-slate-50">
            Cancelar
          </button>
          <button onClick={save} disabled={saving}
            className={clsx("flex-1 rounded-lg py-2.5 text-sm font-semibold text-white disabled:opacity-50",
              cor === "green" ? "bg-green-600 hover:bg-green-700" : "bg-red-500 hover:bg-red-600"
            )}>
            {saving ? "Salvando..." : "Registrar"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── View principal com calendário ────────────────────────────────────────────
export function CalendarioView({ tipo, clients }: { tipo: TipoFixo; clients: Client[] }) {
  const hoje = new Date();
  const [ano, setAno] = useState(hoje.getFullYear());
  const [mes, setMes] = useState(hoje.getMonth() + 1);
  const [transacoes, setTransacoes] = useState<Transacao[]>([]);
  const [loading, setLoading] = useState(true);
  const [diaSelecionado, setDiaSelecionado] = useState<number | null>(hoje.getDate());
  const [modal, setModal] = useState<string | null>(null); // data ISO ou null
  const [editando, setEditando] = useState<Transacao | null>(null);

  useEffect(() => { load(); }, [ano, mes]);

  async function load() {
    setLoading(true);
    const res = await fetch(`/api/financeiro?ano=${ano}&mes=${mes}`);
    const data = await res.json();
    const filtradas = (data.transacoes ?? []).filter((t: Transacao) => t.tipo === tipo);
    setTransacoes(filtradas);
    setLoading(false);
  }

  function navMes(dir: 1 | -1) {
    let m = mes + dir; let a = ano;
    if (m > 12) { m = 1; a++; } if (m < 1) { m = 12; a--; }
    setMes(m); setAno(a); setDiaSelecionado(null);
  }

  // Agrupa transações por dia
  const porDia: Record<number, Transacao[]> = {};
  for (const t of transacoes) {
    const d = parseInt(t.data.slice(8, 10));
    if (!porDia[d]) porDia[d] = [];
    porDia[d].push(t);
  }

  const totalMes = transacoes.reduce((s, t) => s + t.valor, 0);
  const totalDia = diaSelecionado ? (porDia[diaSelecionado] ?? []).reduce((s, t) => s + t.valor, 0) : 0;
  const cor = tipo === "receita";

  // Calendário
  const totalDias = daysInMonth(ano, mes);
  const inicioSemana = firstWeekday(ano, mes);
  const cells: (number | null)[] = [
    ...Array(inicioSemana).fill(null),
    ...Array.from({ length: totalDias }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  async function handleDelete(id: string) {
    if (!confirm("Remover?")) return;
    await fetch(`/api/financeiro/${id}`, { method: "DELETE" });
    setTransacoes((prev) => prev.filter((t) => t.id !== id));
  }

  async function handleStatusToggle(t: Transacao) {
    const next = t.status === "pago" ? "pendente" : t.status === "pendente" ? "atrasado" : "pago";
    const res = await fetch(`/api/financeiro/${t.id}`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: next }),
    });
    const updated = await res.json();
    setTransacoes((prev) => prev.map((x) => x.id === t.id ? updated : x));
  }

  function handleSaved(t: Transacao) {
    setTransacoes((prev) => {
      const idx = prev.findIndex((x) => x.id === t.id);
      return idx >= 0 ? prev.map((x) => x.id === t.id ? t : x) : [t, ...prev];
    });
  }

  const diaTransacoes = diaSelecionado ? (porDia[diaSelecionado] ?? []) : [];
  const dataModalStr = diaSelecionado
    ? `${ano}-${String(mes).padStart(2, "0")}-${String(diaSelecionado).padStart(2, "0")}`
    : "";

  return (
    <div className="p-6 lg:p-8 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className={clsx("text-2xl font-bold", cor ? "text-green-700" : "text-red-600")}>
            {cor ? "↑ Receitas" : "↓ Despesas"}
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {loading ? "Carregando..." : `${fmt(totalMes)} em ${MESES[mes - 1]} · ${transacoes.length} lançamento${transacoes.length !== 1 ? "s" : ""}`}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1 rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-sm">
            <button onClick={() => navMes(-1)} className="text-slate-400 hover:text-slate-700 px-1 text-lg">‹</button>
            <span className="text-sm font-semibold text-slate-800 w-32 text-center">{MESES[mes - 1]} {ano}</span>
            <button onClick={() => navMes(1)} className="text-slate-400 hover:text-slate-700 px-1 text-lg">›</button>
          </div>
          <button
            onClick={() => setModal(dataModalStr || `${ano}-${String(mes).padStart(2,"0")}-01`)}
            className={clsx("rounded-xl px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition",
              cor ? "bg-green-600 hover:bg-green-700" : "bg-red-500 hover:bg-red-600"
            )}
          >
            + {cor ? "Receita" : "Despesa"}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* Calendário */}
        <div className="lg:col-span-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="grid grid-cols-7 mb-2">
            {DIAS_SEMANA.map((d) => (
              <div key={d} className="text-center text-xs font-semibold text-slate-400 py-1">{d}</div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {cells.map((dia, i) => {
              if (!dia) return <div key={i} />;
              const txs = porDia[dia] ?? [];
              const total = txs.reduce((s, t) => s + t.valor, 0);
              const temTxs = txs.length > 0;
              const isHoje = dia === hoje.getDate() && mes === hoje.getMonth() + 1 && ano === hoje.getFullYear();
              const isSel = dia === diaSelecionado;
              const temAtrasado = txs.some((t) => t.status === "atrasado");
              const temPendente = txs.some((t) => t.status === "pendente");

              return (
                <button
                  key={dia}
                  onClick={() => setDiaSelecionado(isSel ? null : dia)}
                  className={clsx(
                    "relative rounded-xl p-1.5 text-center transition flex flex-col items-center gap-0.5 min-h-[56px]",
                    isSel
                      ? cor ? "bg-green-600 text-white" : "bg-red-500 text-white"
                      : temTxs
                      ? cor ? "bg-green-50 hover:bg-green-100 border border-green-200" : "bg-red-50 hover:bg-red-100 border border-red-200"
                      : "hover:bg-slate-50"
                  )}
                >
                  <span className={clsx("text-sm font-semibold",
                    isSel ? "text-white" :
                    isHoje ? (cor ? "text-green-700" : "text-red-600") :
                    temTxs ? "text-slate-800" : "text-slate-400"
                  )}>
                    {isHoje && !isSel && (
                      <span className={clsx("absolute top-1 right-1 h-1.5 w-1.5 rounded-full", cor ? "bg-green-500" : "bg-red-400")} />
                    )}
                    {dia}
                  </span>
                  {temTxs && (
                    <>
                      <span className={clsx("text-xs font-medium leading-none",
                        isSel ? "text-white/90" : cor ? "text-green-700" : "text-red-600"
                      )}>
                        {fmtShort(total)}
                      </span>
                      <span className={clsx("text-xs leading-none",
                        isSel ? "text-white/70" : "text-slate-400"
                      )}>
                        {txs.length}x
                      </span>
                      {(temAtrasado || temPendente) && !isSel && (
                        <span className={clsx("h-1.5 w-1.5 rounded-full",
                          temAtrasado ? "bg-red-500" : "bg-yellow-400"
                        )} />
                      )}
                    </>
                  )}
                </button>
              );
            })}
          </div>

          {/* Legenda */}
          <div className="mt-4 flex items-center gap-4 text-xs text-slate-400">
            <span className="flex items-center gap-1.5">
              <span className={clsx("h-3 w-3 rounded", cor ? "bg-green-100 border border-green-200" : "bg-red-100 border border-red-200")} />
              Com lançamento
            </span>
            <span className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-yellow-400" /> Pendente</span>
            <span className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-red-500" /> Atrasado</span>
          </div>
        </div>

        {/* Painel lateral — dia selecionado */}
        <div className="lg:col-span-2 rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          {diaSelecionado ? (
            <>
              <div className={clsx("px-5 py-4 flex items-center justify-between",
                cor ? "bg-green-600" : "bg-red-500"
              )}>
                <div>
                  <p className="font-semibold text-white text-sm">
                    {diaSelecionado} de {MESES[mes - 1]}
                  </p>
                  <p className="text-white/80 text-xs mt-0.5">
                    {diaTransacoes.length === 0 ? "Nenhum lançamento" : fmt(totalDia)}
                  </p>
                </div>
                <button
                  onClick={() => setModal(dataModalStr)}
                  className="rounded-lg bg-white/20 hover:bg-white/30 px-3 py-1.5 text-xs font-semibold text-white transition"
                >
                  + Adicionar
                </button>
              </div>

              <div className="divide-y divide-slate-50 overflow-y-auto max-h-[420px]">
                {diaTransacoes.length === 0 ? (
                  <div className="py-10 text-center">
                    <p className="text-sm text-slate-400 mb-3">Nenhum lançamento neste dia</p>
                    <button onClick={() => setModal(dataModalStr)}
                      className={clsx("text-sm font-medium", cor ? "text-green-600 hover:text-green-700" : "text-red-500 hover:text-red-600")}>
                      + Registrar {cor ? "receita" : "despesa"}
                    </button>
                  </div>
                ) : diaTransacoes.map((t) => (
                  <div key={t.id} className="px-4 py-3 hover:bg-slate-50 transition group">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-slate-800 truncate">{t.descricao}</p>
                        <p className="text-xs text-slate-400 mt-0.5">{t.categoria}</p>
                        {t.recorrente && <span className="text-xs text-blue-500">↺ recorrente</span>}
                      </div>
                      <div className="text-right shrink-0">
                        <p className={clsx("font-bold text-sm", cor ? "text-green-700" : "text-red-600")}>
                          {fmt(t.valor)}
                        </p>
                        <button onClick={() => handleStatusToggle(t)}
                          className={clsx("text-xs rounded-full px-2 py-0.5 mt-1 font-medium transition",
                            t.status === "pago" ? "bg-green-100 text-green-700" :
                            t.status === "pendente" ? "bg-yellow-100 text-yellow-700" :
                            "bg-red-100 text-red-600"
                          )}>
                          {t.status === "pago" ? "Pago" : t.status === "pendente" ? "Pendente" : "Atrasado"}
                        </button>
                      </div>
                    </div>
                    <div className="flex gap-2 mt-2 opacity-0 group-hover:opacity-100 transition">
                      <button onClick={() => handleDelete(t.id)} className="text-xs text-slate-400 hover:text-red-500">Remover</button>
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="flex flex-col items-center justify-center h-full py-16 px-5 text-center">
              <div className={clsx("flex h-14 w-14 items-center justify-center rounded-2xl text-2xl mb-3",
                cor ? "bg-green-100" : "bg-red-100"
              )}>
                {cor ? "📅" : "📆"}
              </div>
              <p className="text-sm font-medium text-slate-700 mb-1">Selecione um dia</p>
              <p className="text-xs text-slate-400">Clique em qualquer dia do calendário para ver ou registrar {cor ? "receitas" : "despesas"}</p>
            </div>
          )}
        </div>
      </div>

      {/* Modal */}
      {(modal || editando) && (
        <NovaTransacaoModal
          tipo={tipo}
          dataInicial={modal ?? editando?.data ?? dataModalStr}
          clients={clients}
          onSave={handleSaved}
          onClose={() => { setModal(null); setEditando(null); }}
        />
      )}
    </div>
  );
}
