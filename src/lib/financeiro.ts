import { readDocument, writeDocument, withDataTransaction } from "./document-store";
import path from "path";
import { randomUUID } from "crypto";
import type { Transacao, ResumoMes } from "./financeiro-types";

export type { TipoTransacao, StatusTransacao, Transacao, ResumoMes } from "./financeiro-types";
export { CATEGORIAS_RECEITA, CATEGORIAS_DESPESA } from "./financeiro-types";

const FILE = path.join(process.cwd(), "data", "financeiro.json");

async function load(): Promise<Transacao[]> {
  return (await readDocument<Transacao[]>("financeiro.json", []));
}

async function save(data: Transacao[]) {
  await writeDocument("financeiro.json", data);
}

export async function getTransacoes(): Promise<Transacao[]> { return (await load()); }

export async function getTransacoesMes(ano: number, mes: number): Promise<Transacao[]> {
  const prefix = `${ano}-${String(mes).padStart(2, "0")}`;
  return (await load()).filter((t) => t.data.startsWith(prefix));
}

export async function createTransacao(data: Omit<Transacao, "id" | "createdAt">): Promise<Transacao> {
  return withDataTransaction(async () => {
  const all = (await load());
  const t: Transacao = { ...data, id: randomUUID(), createdAt: new Date().toISOString() };
  all.push(t);
  (await save(all));
  return t;

  });
}

export async function updateTransacao(id: string, patch: Partial<Omit<Transacao, "id" | "createdAt">>): Promise<Transacao | null> {
  return withDataTransaction(async () => {
  const all = (await load());
  const idx = all.findIndex((t) => t.id === id);
  if (idx < 0) return null;
  all[idx] = { ...all[idx], ...patch };
  (await save(all));
  return all[idx];

  });
}

export async function deleteTransacao(id: string): Promise<boolean> {
  return withDataTransaction(async () => {
  const all = (await load());
  const filtered = all.filter((t) => t.id !== id);
  if (filtered.length === all.length) return false;
  (await save(filtered));
  return true;

  });
}

export function calcularResumo(transacoes: Transacao[]): ResumoMes {
  const receitas = transacoes.filter((t) => t.tipo === "receita");
  const despesas = transacoes.filter((t) => t.tipo === "despesa");

  const totalReceitas = receitas.reduce((s, t) => s + t.valor, 0);
  const totalDespesas = despesas.reduce((s, t) => s + t.valor, 0);
  const lucro = totalReceitas - totalDespesas;
  const margem = totalReceitas > 0 ? (lucro / totalReceitas) * 100 : 0;

  const receitasPorCategoria: Record<string, number> = {};
  for (const t of receitas) {
    receitasPorCategoria[t.categoria] = (receitasPorCategoria[t.categoria] ?? 0) + t.valor;
  }

  const despesasPorCategoria: Record<string, number> = {};
  for (const t of despesas) {
    despesasPorCategoria[t.categoria] = (despesasPorCategoria[t.categoria] ?? 0) + t.valor;
  }

  const receitasPorCliente: Record<string, number> = {};
  for (const t of receitas) {
    if (t.clientId) {
      receitasPorCliente[t.clientId] = (receitasPorCliente[t.clientId] ?? 0) + t.valor;
    }
  }

  const pendentes = transacoes.filter((t) => t.status === "pendente").length;
  const atrasados = transacoes.filter((t) => t.status === "atrasado").length;

  return { totalReceitas, totalDespesas, lucro, margem, receitasPorCategoria, despesasPorCategoria, receitasPorCliente, pendentes, atrasados };
}

export async function getHistoricoMeses(n = 6): Promise<{ mes: string; receitas: number; despesas: number; lucro: number }[]> {
  const all = (await load());
  const result = [];
  const hoje = new Date();

  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(hoje.getFullYear(), hoje.getMonth() - i, 1);
    const ano = d.getFullYear();
    const mes = d.getMonth() + 1;
    const prefix = `${ano}-${String(mes).padStart(2, "0")}`;
    const trans = all.filter((t) => t.data.startsWith(prefix));
    const receitas = trans.filter((t) => t.tipo === "receita").reduce((s, t) => s + t.valor, 0);
    const despesas = trans.filter((t) => t.tipo === "despesa").reduce((s, t) => s + t.valor, 0);
    result.push({
      mes: d.toLocaleDateString("pt-BR", { month: "short", year: "2-digit" }),
      receitas,
      despesas,
      lucro: receitas - despesas,
    });
  }
  return result;
}
