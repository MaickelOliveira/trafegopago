import type { Pessoa } from "./pousada-types";

export type StatusPagamentoPessoa = "pendente" | "parcial" | "pago" | "cortesia";

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

export function statusPagamentoPessoa(pessoa: Pessoa): StatusPagamentoPessoa {
  const valor = valorPessoa(pessoa);
  const pago = valorPagoPessoa(pessoa);
  if (pessoa.gratuito || valor <= 0) return "cortesia";
  if (pago >= valor) return "pago";
  if (pago > 0) return "parcial";
  return "pendente";
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

/** Altera o valor total de um evento sem deixar a soma individual divergente.
 * Pessoas gratuitas continuam gratuitas; o novo total é dividido
 * proporcionalmente entre as demais (ou igualmente quando ainda não havia
 * valores), preservando pagamentos já realizados até o novo limite. */
export function distribuirValorTotalPelasPessoas(pessoas: Pessoa[], valorTotal: number): Pessoa[] {
  const normalized = normalizarPagamentosIndividuais(pessoas);
  const target = toCents(valorTotal);
  const elegiveis = normalized
    .map((pessoa, index) => ({ pessoa, index }))
    .filter(({ pessoa }) => !pessoa.gratuito);

  if (elegiveis.length === 0) {
    if (target === 0 || normalized.length === 0) {
      return normalized.map((pessoa) => ({ ...pessoa, valor: 0, valorPago: 0 }));
    }
    // Se todos estavam como cortesia e o operador informou um total positivo,
    // todas as pessoas passam a participar da divisão desse novo valor.
    elegiveis.push(...normalized.map((pessoa, index) => ({ pessoa: { ...pessoa, gratuito: false }, index })));
  }

  const totalAtual = elegiveis.reduce((total, { pessoa }) => total + toCents(pessoa.valor), 0);
  const parcelas = elegiveis.map(({ pessoa, index }) => {
    const peso = totalAtual > 0 ? toCents(pessoa.valor) / totalAtual : 1 / elegiveis.length;
    const bruto = target * peso;
    return { index, cents: Math.floor(bruto), fraction: bruto - Math.floor(bruto) };
  });
  let restante = target - parcelas.reduce((total, parcela) => total + parcela.cents, 0);

  for (const parcela of [...parcelas].sort((a, b) => b.fraction - a.fraction || a.index - b.index)) {
    if (restante <= 0) break;
    parcelas.find((item) => item.index === parcela.index)!.cents += 1;
    restante -= 1;
  }

  const valorPorIndice = new Map(parcelas.map((parcela) => [parcela.index, parcela.cents]));
  return normalized.map((pessoa, index) => {
    const novoValor = valorPorIndice.get(index);
    if (novoValor === undefined) return { ...pessoa, valor: 0, valorPago: 0 };
    return {
      ...pessoa,
      gratuito: false,
      valor: fromCents(novoValor),
      valorPago: fromCents(Math.min(toCents(pessoa.valorPago), novoValor)),
    };
  });
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
