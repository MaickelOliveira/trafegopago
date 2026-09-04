import type { Pessoa } from "./pousada-types";

function toCents(value: number | undefined): number {
  return Math.max(Math.round((Number(value) || 0) * 100), 0);
}

function fromCents(value: number): number {
  return value / 100;
}

export function valorPessoa(pessoa: Pessoa): number {
  return pessoa.gratuito ? 0 : fromCents(toCents(pessoa.valor));
}

export function valorPagoPessoa(pessoa: Pessoa): number {
  return fromCents(Math.min(toCents(pessoa.valorPago), toCents(valorPessoa(pessoa))));
}

export function faltaPagarPessoa(pessoa: Pessoa): number {
  return fromCents(Math.max(toCents(valorPessoa(pessoa)) - toCents(valorPagoPessoa(pessoa)), 0));
}

export function somarValorPessoas(pessoas: Pessoa[]): number {
  return fromCents(pessoas.reduce((total, pessoa) => total + toCents(valorPessoa(pessoa)), 0));
}

export function somarValorPagoPessoas(pessoas: Pessoa[]): number {
  return fromCents(pessoas.reduce((total, pessoa) => total + toCents(valorPagoPessoa(pessoa)), 0));
}

export function temPagamentosIndividuais(pessoas: Pessoa[]): boolean {
  return pessoas.some((pessoa) => typeof pessoa.valorPago === "number" && Number.isFinite(pessoa.valorPago));
}

export function normalizarPagamentosIndividuais(pessoas: Pessoa[]): Pessoa[] {
  return pessoas.map((pessoa) => ({
    ...pessoa,
    valor: valorPessoa(pessoa),
    valorPago: valorPagoPessoa(pessoa),
  }));
}

/** Distribui um pagamento feito no total da reserva proporcionalmente ao
 * valor de cada pessoa. Trabalhar em centavos garante que a soma individual
 * seja exatamente igual ao total pago, sem sobrar ou faltar por arredondamento. */
export function distribuirPagamentoPelasPessoas(pessoas: Pessoa[], valorPagoTotal: number): Pessoa[] {
  const normalized = pessoas.map((pessoa) => ({ ...pessoa, valor: valorPessoa(pessoa), valorPago: 0 }));
  const valores = normalized.map((pessoa) => toCents(pessoa.valor));
  const total = valores.reduce((sum, value) => sum + value, 0);
  const target = Math.min(toCents(valorPagoTotal), total);
  if (total === 0 || target === 0) return normalized;

  const shares = valores.map((value, index) => {
    const raw = (target * value) / total;
    return { index, cents: Math.floor(raw), fraction: raw - Math.floor(raw), limit: value };
  });
  let remaining = target - shares.reduce((sum, share) => sum + share.cents, 0);

  for (const share of [...shares].sort((a, b) => b.fraction - a.fraction || a.index - b.index)) {
    if (remaining <= 0) break;
    if (share.cents < share.limit) {
      shares[share.index].cents += 1;
      remaining -= 1;
    }
  }

  return normalized.map((pessoa, index) => ({ ...pessoa, valorPago: fromCents(shares[index].cents) }));
}

/** Reservas antigas têm apenas valorPago no total. Na leitura, distribui
 * esse total entre as pessoas; reservas novas preservam os valores individuais. */
export function pessoasComPagamentos(
  pessoas: Pessoa[],
  valorPagoTotal: number,
): Pessoa[] {
  return temPagamentosIndividuais(pessoas)
    ? normalizarPagamentosIndividuais(pessoas)
    : distribuirPagamentoPelasPessoas(pessoas, valorPagoTotal);
}

export function statusPorPagamentos(
  statusAtual: "pendente" | "parcial" | "pago" | "cancelada" | "cortesia",
  valorTotal: number,
  valorPago: number,
) {
  if (statusAtual === "cancelada") return statusAtual;
  if (statusAtual === "cortesia") return statusAtual;
  if (valorTotal <= 0) return "cortesia" as const;
  if (valorPago >= valorTotal) return "pago" as const;
  if (valorPago > 0) return "parcial" as const;
  return "pendente" as const;
}
