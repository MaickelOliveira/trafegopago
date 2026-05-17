"use client";

import { useState, useEffect } from "react";
import { clsx } from "clsx";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import type { Transacao, ResumoMes } from "@/lib/financeiro-types";
import { CATEGORIAS_RECEITA, CATEGORIAS_DESPESA } from "@/lib/financeiro-types";

type Client = { id: string; name: string; color: string };
type Historico = { mes: string; receitas: number; despesas: number; lucro: number };

const MESES = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];

function fmt(v: number) {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function statusBadge(status: string) {
  return status === "pago"
    ? "bg-green-100 text-green-700"
    : status === "pendente"
    ? "bg-yellow-100 text-yellow-700"
    : "bg-red-100 text-red-600";
}

const statusLabel: Record<string, string> = { pago: "Pago", pendente: "Pendente", atrasado: "Atrasado" };

// ── Modal de transação ────────────────────────────────────────────────────────
function TransacaoModal({
  initial, clients, anoMes, onSave, onClose,
}: {
  initial?: Transacao | null;
  clients: Client[];
  anoMes: { ano: number; mes: number };
  onSave: (t: Transacao) => void;
  onClose: () => void;
}) {
  const defaultData = `${anoMes.ano}-${String(anoMes.mes).padStart(2, "0")}-01`;
  const [form, setForm] = useState({
    tipo: initial?.tipo ?? "receita" as "receita" | "despesa",
    categoria: initial?.categoria ?? "",
    descricao: initial?.descricao ?? "",
    valor: initial?.valor?.toString() ?? "",
    data: initial?.data ?? defaultData,
    clientId: initial?.clientId ?? "",
    recorrente: initial?.recorrente ?? false,
    diaVencimento: initial?.diaVencimento?.toString() ?? "",
    status: initial?.status ?? "pago",
  });
  const [saving, setSaving] = useState(false);

  const categorias = form.tipo === "receita" ? CATEGORIAS_RECEITA : CATEGORIAS_DESPESA;

  async function save() {
    if (!form.descricao || !form.valor || !form.categoria) return;
    setSaving(true);
    const url = initial ? `/api/financeiro/${initial.id}` : "/api/financeiro";
    const method = initial ? "PUT" : "POST";
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...form, valor: Number(form.valor) }),
    });
    const t = await res.json();
    if (res.ok) { onSave(t); onClose(); }
    setSaving(false);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <h2 className="font-semibold text-slate-900">{initial ? "Editar" : "Nova"} transação</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl leading-none">×</button>
        </div>
        <div className="p-6 space-y-4">
          {/* Tipo */}
          <div className="flex gap-2">
            {(["receita", "despesa"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setForm((f) => ({ ...f, tipo: t, categoria: "" }))}
                className={clsx(
                  "flex-1 rounded-lg py-2 text-sm font-semibold transition border",
                  form.tipo === t
                    ? t === "receita" ? "bg-green-600 text-white border-green-600" : "bg-red-500 text-white border-red-500"
                    : "border-slate-200 text-slate-600 hover:bg-slate-50"
                )}
              >
                {t === "receita" ? "↑ Receita" : "↓ Despesa"}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-3">
            {/* Descrição */}
            <div className="col-span-2">
              <label className="text-xs font-medium text-slate-600 block mb-1">Descrição *</label>
              <input value={form.descricao} onChange={(e) => setForm((f) => ({ ...f, descricao: e.target.value }))}
                placeholder={form.tipo === "receita" ? "Mensalidade SBcie" : "UazAPI"}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-400" />
            </div>

            {/* Valor */}
            <div>
              <label className="text-xs font-medium text-slate-600 block mb-1">Valor (R$) *</label>
              <input value={form.valor} onChange={(e) => setForm((f) => ({ ...f, valor: e.target.value }))}
                type="number" step="0.01" placeholder="1500,00"
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-400" />
            </div>

            {/* Data */}
            <div>
              <label className="text-xs font-medium text-slate-600 block mb-1">Data *</label>
              <input value={form.data} onChange={(e) => setForm((f) => ({ ...f, data: e.target.value }))}
                type="date"
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-400" />
            </div>

            {/* Categoria */}
            <div>
              <label className="text-xs font-medium text-slate-600 block mb-1">Categoria *</label>
              <select value={form.categoria} onChange={(e) => setForm((f) => ({ ...f, categoria: e.target.value }))}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-400 bg-white">
                <option value="">Selecionar</option>
                {categorias.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>

            {/* Status */}
            <div>
              <label className="text-xs font-medium text-slate-600 block mb-1">Status</label>
              <select value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as Transacao["status"] }))}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-400 bg-white">
                <option value="pago">Pago</option>
                <option value="pendente">Pendente</option>
                <option value="atrasado">Atrasado</option>
              </select>
            </div>

            {/* Cliente (só receita) */}
            {form.tipo === "receita" && (
              <div className="col-span-2">
                <label className="text-xs font-medium text-slate-600 block mb-1">Cliente</label>
                <select value={form.clientId} onChange={(e) => setForm((f) => ({ ...f, clientId: e.target.value }))}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-400 bg-white">
                  <option value="">Sem cliente</option>
                  {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
            )}

            {/* Recorrente */}
            <div className="col-span-2 flex items-center gap-3 rounded-lg border border-slate-200 px-3 py-2.5">
              <input type="checkbox" id="recorrente" checked={form.recorrente}
                onChange={(e) => setForm((f) => ({ ...f, recorrente: e.target.checked }))}
                className="h-4 w-4 rounded accent-blue-600" />
              <label htmlFor="recorrente" className="text-sm text-slate-700 cursor-pointer flex-1">
                Recorrente (todo mês)
              </label>
              {form.recorrente && (
                <input value={form.diaVencimento} onChange={(e) => setForm((f) => ({ ...f, diaVencimento: e.target.value }))}
                  type="number" min="1" max="31" placeholder="Dia"
                  className="w-16 rounded-lg border border-slate-200 px-2 py-1 text-sm outline-none focus:border-blue-400 text-center" />
              )}
            </div>
          </div>
        </div>

        <div className="flex gap-3 border-t border-slate-100 px-6 py-4">
          <button onClick={onClose} className="flex-1 rounded-lg border border-slate-200 py-2.5 text-sm text-slate-600 hover:bg-slate-50">
            Cancelar
          </button>
          <button onClick={save} disabled={saving || !form.descricao || !form.valor || !form.categoria}
            className="flex-1 rounded-lg bg-blue-600 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
            {saving ? "Salvando..." : "Salvar"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── View principal ────────────────────────────────────────────────────────────
export function FinanceiroView({
  clients,
  tipoFixo,
}: {
  clients: Client[];
  tipoFixo?: "receita" | "despesa";
}) {
  const hoje = new Date();
  const [ano, setAno]   = useState(hoje.getFullYear());
  const [mes, setMes]   = useState(hoje.getMonth() + 1);
  const [transacoes, setTransacoes] = useState<Transacao[]>([]);
  const [resumo, setResumo]   = useState<ResumoMes | null>(null);
  const [historico, setHistorico] = useState<Historico[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal]     = useState<"new" | Transacao | null>(null);
  const [filtroTipo, setFiltroTipo] = useState<"todos" | "receita" | "despesa">(tipoFixo ?? "todos");

  useEffect(() => { load(); }, [ano, mes]);

  async function load() {
    setLoading(true);
    const res = await fetch(`/api/financeiro?ano=${ano}&mes=${mes}`);
    const data = await res.json();
    setTransacoes(data.transacoes ?? []);
    setResumo(data.resumo ?? null);
    setHistorico(data.historico ?? []);
    setLoading(false);
  }

  function navMes(dir: 1 | -1) {
    let m = mes + dir;
    let a = ano;
    if (m > 12) { m = 1; a++; }
    if (m < 1)  { m = 12; a--; }
    setMes(m); setAno(a);
  }

  function handleSaved(t: Transacao) {
    setTransacoes((prev) => {
      const idx = prev.findIndex((x) => x.id === t.id);
      if (idx >= 0) { const n = [...prev]; n[idx] = t; return n; }
      return [t, ...prev];
    });
    load(); // recalcula resumo
  }

  async function handleDelete(id: string) {
    if (!confirm("Remover esta transação?")) return;
    await fetch(`/api/financeiro/${id}`, { method: "DELETE" });
    setTransacoes((prev) => prev.filter((t) => t.id !== id));
    load();
  }

  async function toggleStatus(t: Transacao) {
    const next = t.status === "pago" ? "pendente" : t.status === "pendente" ? "atrasado" : "pago";
    const res = await fetch(`/api/financeiro/${t.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: next }),
    });
    const updated = await res.json();
    handleSaved(updated);
  }

  const clientMap = Object.fromEntries(clients.map((c) => [c.id, c]));
  const visíveis = transacoes.filter((t) => filtroTipo === "todos" || t.tipo === filtroTipo);
  const receitas = transacoes.filter((t) => t.tipo === "receita");
  const despesas = transacoes.filter((t) => t.tipo === "despesa");

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Financeiro</h1>
          <p className="text-sm text-slate-500 mt-0.5">Controle financeiro da agência</p>
        </div>
        <div className="flex items-center gap-3">
          {/* Navegação de mês */}
          <div className="flex items-center gap-1 rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-sm">
            <button onClick={() => navMes(-1)} className="text-slate-400 hover:text-slate-700 px-1 text-lg">‹</button>
            <span className="text-sm font-semibold text-slate-800 w-32 text-center">
              {MESES[mes - 1]} {ano}
            </span>
            <button onClick={() => navMes(1)} className="text-slate-400 hover:text-slate-700 px-1 text-lg">›</button>
          </div>
          <button
            onClick={() => setModal("new")}
            className="rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 transition shadow-sm"
          >
            + Lançamento
          </button>
        </div>
      </div>

      {/* KPIs */}
      {resumo && (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <KPICard
            label="Receitas"
            value={fmt(resumo.totalReceitas)}
            sub={`${receitas.length} lançamento${receitas.length !== 1 ? "s" : ""}`}
            variant="success"
            icon="↑"
          />
          <KPICard
            label="Despesas"
            value={fmt(resumo.totalDespesas)}
            sub={`${despesas.length} lançamento${despesas.length !== 1 ? "s" : ""}`}
            variant="danger"
            icon="↓"
          />
          <KPICard
            label="Lucro líquido"
            value={fmt(resumo.lucro)}
            sub={`Margem ${resumo.margem.toFixed(1)}%`}
            variant={resumo.lucro >= 0 ? "success" : "danger"}
            icon="="
          />
          <KPICard
            label="Pendências"
            value={String(resumo.pendentes + resumo.atrasados)}
            sub={resumo.atrasados > 0 ? `${resumo.atrasados} atrasado${resumo.atrasados !== 1 ? "s" : ""}` : "Tudo em dia"}
            variant={resumo.atrasados > 0 ? "danger" : resumo.pendentes > 0 ? "warning" : "success"}
            icon="⏰"
          />
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Gráfico histórico */}
        <div className="lg:col-span-2 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-slate-700 mb-4">Últimos 6 meses</h2>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={historico} barGap={4}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="mes" tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false}
                tickFormatter={(v) => `R$${(v/1000).toFixed(0)}k`} />
              <Tooltip formatter={(v) => fmt(Number(v))} />
              <Legend iconSize={8} wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="receitas" name="Receitas" fill="#22c55e" radius={[4, 4, 0, 0]} />
              <Bar dataKey="despesas" name="Despesas" fill="#f87171" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Receita por cliente */}
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-slate-700 mb-4">Receita por cliente</h2>
          {resumo && Object.keys(resumo.receitasPorCliente).length > 0 ? (
            <div className="space-y-2.5">
              {Object.entries(resumo.receitasPorCliente)
                .sort(([, a], [, b]) => b - a)
                .map(([cId, val]) => {
                  const client = clientMap[cId];
                  const pct = resumo.totalReceitas > 0 ? (val / resumo.totalReceitas) * 100 : 0;
                  return (
                    <div key={cId}>
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-1.5">
                          {client && <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: client.color }} />}
                          <span className="text-xs text-slate-700 font-medium">{client?.name ?? cId}</span>
                        </div>
                        <span className="text-xs font-semibold text-slate-800">{fmt(val)}</span>
                      </div>
                      <div className="h-1.5 rounded-full bg-slate-100">
                        <div className="h-1.5 rounded-full bg-green-500" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
            </div>
          ) : (
            <p className="text-sm text-slate-400 italic text-center mt-8">Nenhuma receita por cliente ainda</p>
          )}
        </div>
      </div>

      {/* Lista de transações */}
      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3.5 flex-wrap gap-2">
          <h2 className="text-sm font-semibold text-slate-700">
            {tipoFixo === "receita" ? "Receitas" : tipoFixo === "despesa" ? "Despesas" : "Lançamentos"} — {MESES[mes - 1]}
          </h2>
          {!tipoFixo && (
            <div className="flex gap-1">
              {(["todos", "receita", "despesa"] as const).map((f) => (
                <button key={f} onClick={() => setFiltroTipo(f)}
                  className={clsx("rounded-md px-3 py-1 text-xs font-medium transition",
                    filtroTipo === f ? "bg-slate-900 text-white" : "text-slate-500 hover:bg-slate-100"
                  )}>
                  {f === "todos" ? "Todos" : f === "receita" ? "Receitas" : "Despesas"}
                </button>
              ))}
            </div>
          )}
        </div>

        {loading ? (
          <div className="py-12 text-center text-sm text-slate-400">Carregando...</div>
        ) : visíveis.length === 0 ? (
          <div className="py-12 text-center">
            <p className="text-sm text-slate-400 mb-3">Nenhum lançamento neste mês</p>
            <button onClick={() => setModal("new")} className="text-sm text-blue-600 hover:underline font-medium">
              + Adicionar primeiro lançamento
            </button>
          </div>
        ) : (
          <div className="divide-y divide-slate-50">
            {visíveis
              .sort((a, b) => b.data.localeCompare(a.data))
              .map((t) => {
                const client = t.clientId ? clientMap[t.clientId] : null;
                return (
                  <div key={t.id} className="flex items-center gap-4 px-5 py-3.5 hover:bg-slate-50 transition group">
                    {/* Ícone tipo */}
                    <div className={clsx("flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-sm font-bold",
                      t.tipo === "receita" ? "bg-green-100 text-green-700" : "bg-red-100 text-red-600"
                    )}>
                      {t.tipo === "receita" ? "↑" : "↓"}
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-semibold text-slate-800 truncate">{t.descricao}</p>
                        {t.recorrente && <span className="rounded-full bg-blue-100 px-1.5 py-0.5 text-xs text-blue-600">↺ recorrente</span>}
                        {client && (
                          <span className="flex items-center gap-1 rounded-full bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">
                            <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: client.color }} />
                            {client.name}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-slate-400 mt-0.5">{t.categoria} · {new Date(t.data + "T00:00:00").toLocaleDateString("pt-BR")}</p>
                    </div>

                    {/* Status */}
                    <button onClick={() => toggleStatus(t)} title="Clique para alterar status"
                      className={clsx("rounded-full px-2.5 py-1 text-xs font-medium transition hover:opacity-80", statusBadge(t.status))}>
                      {statusLabel[t.status]}
                    </button>

                    {/* Valor */}
                    <p className={clsx("text-base font-bold shrink-0",
                      t.tipo === "receita" ? "text-green-700" : "text-red-600"
                    )}>
                      {t.tipo === "receita" ? "+" : "-"}{fmt(t.valor)}
                    </p>

                    {/* Ações */}
                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition shrink-0">
                      <button onClick={() => setModal(t)} className="rounded-lg p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 transition">
                        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                        </svg>
                      </button>
                      <button onClick={() => handleDelete(t.id)} className="rounded-lg p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 transition">
                        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </div>
                  </div>
                );
              })}
          </div>
        )}
      </div>

      {/* Modal */}
      {modal && (
        <TransacaoModal
          initial={modal === "new" ? null : modal}
          clients={clients}
          anoMes={{ ano, mes }}
          onSave={handleSaved}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  );
}

function KPICard({ label, value, sub, variant, icon }: {
  label: string; value: string; sub?: string;
  variant: "success" | "danger" | "warning" | "default";
  icon: string;
}) {
  const styles = {
    success: { border: "border-green-200", bg: "bg-green-50", icon: "bg-green-100 text-green-700", value: "text-green-800" },
    danger:  { border: "border-red-200",   bg: "bg-red-50",   icon: "bg-red-100 text-red-600",     value: "text-red-800" },
    warning: { border: "border-yellow-200",bg: "bg-yellow-50",icon: "bg-yellow-100 text-yellow-700",value: "text-yellow-800" },
    default: { border: "border-slate-200", bg: "bg-white",    icon: "bg-slate-100 text-slate-600", value: "text-slate-900" },
  }[variant];

  return (
    <div className={clsx("rounded-2xl border p-4 shadow-sm", styles.border, styles.bg)}>
      <div className="flex items-start justify-between mb-3">
        <p className="text-xs font-medium text-slate-500">{label}</p>
        <span className={clsx("flex h-8 w-8 items-center justify-center rounded-lg text-sm font-bold", styles.icon)}>{icon}</span>
      </div>
      <p className={clsx("text-xl font-bold", styles.value)}>{value}</p>
      {sub && <p className="text-xs text-slate-400 mt-1">{sub}</p>}
    </div>
  );
}
