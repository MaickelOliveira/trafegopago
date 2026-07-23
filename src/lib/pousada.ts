import { readFileSync, writeFileSync, existsSync } from "fs";
import path from "path";
import { randomUUID } from "crypto";
import type { Reserva, FaixaEtariaResumo } from "./pousada-types";

export type { StatusReserva, OrigemReserva, Pessoa, Reserva, PousadaTipo, CategoriaTipo, FaixaEtariaResumo } from "./pousada-types";
export { TIPOS_PADRAO } from "./pousada-types";

const FILE = path.join(process.cwd(), "data", "pousada-reservas.json");

function load(): Reserva[] {
  try {
    if (!existsSync(FILE)) return [];
    return JSON.parse(readFileSync(FILE, "utf-8"));
  } catch { return []; }
}

function save(data: Reserva[]) {
  writeFileSync(FILE, JSON.stringify(data, null, 2));
}

export function getReservas(clientId: string): Reserva[] {
  return load().filter((r) => r.clientId === clientId);
}

export function getReservasFiltradas(
  clientId: string,
  opts: { tipo?: string; dataInicio?: string; dataFim?: string } = {}
): Reserva[] {
  let rows = getReservas(clientId);
  if (opts.tipo) rows = rows.filter((r) => r.tipo === opts.tipo);
  if (opts.dataInicio) rows = rows.filter((r) => r.data >= opts.dataInicio!);
  if (opts.dataFim) rows = rows.filter((r) => r.data <= opts.dataFim!);
  return rows.sort((a, b) => a.data.localeCompare(b.data));
}

export function getUpcomingReservas(clientId: string, days = 30): Reserva[] {
  const today = new Date().toISOString().slice(0, 10);
  const limit = new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
  return getReservas(clientId)
    .filter((r) => r.data >= today && r.data <= limit && r.status !== "cancelada")
    .sort((a, b) => a.data.localeCompare(b.data));
}

export function getReservaById(id: string): Reserva | undefined {
  return load().find((r) => r.id === id);
}

export function createReserva(data: Omit<Reserva, "id" | "createdAt" | "updatedAt" | "faltaPagar"> & { faltaPagar?: number }): Reserva {
  const all = load();
  const now = new Date().toISOString();
  const faltaPagar = data.faltaPagar ?? Math.max(data.valorTotal - data.valorPago, 0);
  const r: Reserva = { ...data, faltaPagar, id: randomUUID(), createdAt: now, updatedAt: now };
  all.push(r);
  save(all);
  return r;
}

export function updateReserva(id: string, patch: Partial<Omit<Reserva, "id" | "clientId" | "createdAt">>): Reserva | null {
  const all = load();
  const idx = all.findIndex((r) => r.id === id);
  if (idx < 0) return null;
  all[idx] = { ...all[idx], ...patch, updatedAt: new Date().toISOString() };
  save(all);
  return all[idx];
}

export function deleteReserva(id: string): boolean {
  const all = load();
  const filtered = all.filter((r) => r.id !== id);
  if (filtered.length === all.length) return false;
  save(filtered);
  return true;
}

// Equivalente interno do antigo findLastRowByPhone (google-sheets.ts) — usado
// pelo extrator da IA pra dedupe de inserção e lookup de confirmação de pagamento.
export function findReservaByPhone(clientId: string, phone: string, tipo?: string): Reserva | undefined {
  const digits = phone.replace(/\D/g, "").slice(-8);
  if (!digits) return undefined;
  let rows = getReservas(clientId).filter((r) => (r.telefone ?? "").replace(/\D/g, "").endsWith(digits));
  if (tipo) rows = rows.filter((r) => r.tipo === tipo);
  return rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
}

// Computa as faixas etárias na hora, a partir de pessoas[].idade — nunca
// armazenado, pra não correr o risco de dessincronizar com edições posteriores.
export function calcularFaixasEtarias(reservas: Reserva[]): FaixaEtariaResumo {
  let faixa0a5 = 0;
  let faixa6a12 = 0;
  for (const r of reservas) {
    for (const p of r.pessoas) {
      if (typeof p.idade !== "number") continue;
      if (p.idade <= 5) faixa0a5++;
      else if (p.idade <= 12) faixa6a12++;
    }
  }
  return { faixa0a5, faixa6a12 };
}

export type OcupacaoQuarto = { quarto: string; reserva: Reserva };

// Quartos ocupados numa data específica — considera qualquer reserva com
// `quarto` preenchido cujo intervalo [data, dataCheckout ?? data] cubra o dia
// consultado (inclusive nas duas pontas, pra não arriscar dupla-reserva no
// dia da troca de hóspede).
export function getOcupacaoPorData(clientId: string, data: string): OcupacaoQuarto[] {
  return getReservas(clientId)
    .filter((r) => r.quarto && r.status !== "cancelada")
    .filter((r) => data >= r.data && data <= (r.dataCheckout ?? r.data))
    .map((r) => ({ quarto: r.quarto!, reserva: r }));
}

export function calcularTotais(reservas: Reserva[]) {
  return reservas.reduce(
    (acc, r) => ({
      valorTotal: acc.valorTotal + r.valorTotal,
      valorPago: acc.valorPago + r.valorPago,
      faltaPagar: acc.faltaPagar + r.faltaPagar,
    }),
    { valorTotal: 0, valorPago: 0, faltaPagar: 0 }
  );
}
