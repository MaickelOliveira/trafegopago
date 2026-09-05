import { readFileSync, writeFileSync, existsSync } from "fs";
import path from "path";
import { randomUUID } from "crypto";
import type { Reserva, FaixaEtariaResumo } from "./pousada-types";
import { todayBR } from "./format-date";
import {
  distribuirPagamentoPelasPessoas,
  normalizarPagamentosIndividuais,
  pessoasComPagamentos,
  somarValorPagoPessoas,
  somarValorPessoas,
  statusPorPagamentos,
  temPagamentosIndividuais,
} from "./pousada-payments";
import { normalizarConsumoPessoa, preservarConsumoExistente } from "./pousada-consumo";
import { getClientById } from "./clients";

export type {
  StatusReserva,
  OrigemReserva,
  Pessoa,
  Reserva,
  PousadaTipo,
  CategoriaTipo,
  FaixaEtariaResumo,
  ItemConsumoHospede,
  LocalItemConsumo,
} from "./pousada-types";
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

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

function isHospedagemReserva(clientId: string, tipo: string): boolean {
  const tipoConfigurado = getClientById(clientId)?.pousadaTipos?.find((item) => item.slug === tipo);
  if (tipoConfigurado) return tipoConfigurado.categoria === "hospedagem";

  // Compatibilidade com reservas antigas, criadas antes de o tipo passar a
  // guardar explicitamente sua categoria na configuração do cliente.
  return /hospedagem|pernoite|di[aá]ria/i.test(tipo);
}

function semPagamentoIndividual(pessoas: Reserva["pessoas"]): Reserva["pessoas"] {
  return pessoas.map((pessoa) => ({
    ...pessoa,
    valor: 0,
    valorPago: undefined,
    gratuito: undefined,
  }));
}

// Corrige na leitura, sem precisar de migração: (1) faltaPagar nunca deve ser
// confiado como veio salvo — sempre derivado de valorTotal/valorPago, mesmo
// princípio de calcularFaixasEtarias (nunca armazenado); (2) "data"/
// "dataCheckout" às vezes foram gravadas com mais de 10 caracteres (ex: um
// sufixo de horário tipo "T00:00:00.000Z" escapando de algum ponto de escrita
// que não devia gerar isso) — como todo filtro de data no arquivo compara
// essas strings com >=/<= assumindo "AAAA-MM-DD" puro, uma string mais longa
// com o mesmo prefixo de 10 caracteres é lexicograficamente MAIOR e faz a
// reserva sumir de qualquer filtro cujo limite superior seja o próprio dia.
function normalizarReserva(r: Reserva): Reserva {
  const hospedagem = isHospedagemReserva(r.clientId, r.tipo);
  const pessoas = (hospedagem
    ? semPagamentoIndividual(r.pessoas ?? [])
    : pessoasComPagamentos(r.pessoas ?? [], r.valorPago))
    .map(normalizarConsumoPessoa);
  const totalPessoas = somarValorPessoas(pessoas);
  const valorTotal = Math.max(round2(r.valorTotal), 0);
  const valorPago = !hospedagem && totalPessoas > 0
    ? somarValorPagoPessoas(pessoas)
    : Math.min(Math.max(round2(r.valorPago), 0), valorTotal);
  return {
    ...r,
    pessoas,
    data: r.data?.slice(0, 10),
    dataCheckout: r.dataCheckout ? r.dataCheckout.slice(0, 10) : r.dataCheckout,
    valorTotal,
    valorPago,
    faltaPagar: Math.max(round2(valorTotal - valorPago), 0),
    status: statusPorPagamentos(r.status, valorTotal, valorPago),
  };
}

export function getReservas(clientId: string): Reserva[] {
  return load().filter((r) => r.clientId === clientId).map(normalizarReserva);
}

export function getReservasFiltradas(
  clientId: string,
  opts: { tipo?: string; dataInicio?: string; dataFim?: string; incluirArquivadas?: boolean } = {}
): Reserva[] {
  let rows = getReservas(clientId);
  // Relatórios/histórico precisam ver reservas arquivadas ("excluídas" pela
  // equipe) também — só as listas ativas (dashboard, ocupação, próximas
  // reservas) escondem por padrão. Ver comentário em Reserva.arquivada.
  if (!opts.incluirArquivadas) rows = rows.filter((r) => !r.arquivada);
  if (opts.tipo) rows = rows.filter((r) => r.tipo === opts.tipo);
  if (opts.dataInicio) rows = rows.filter((r) => r.data >= opts.dataInicio!);
  if (opts.dataFim) rows = rows.filter((r) => r.data <= opts.dataFim!);
  return rows.sort((a, b) => a.data.localeCompare(b.data));
}

export function getUpcomingReservas(clientId: string, days = 30): Reserva[] {
  const today = todayBR();
  const limit = new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
  return getReservas(clientId)
    .filter((r) => !r.arquivada && r.data >= today && r.data <= limit && r.status !== "cancelada")
    .sort((a, b) => a.data.localeCompare(b.data));
}

export function getReservaById(id: string): Reserva | undefined {
  const r = load().find((r) => r.id === id);
  return r ? normalizarReserva(r) : undefined;
}

export function createReserva(data: Omit<Reserva, "id" | "createdAt" | "updatedAt" | "faltaPagar"> & { faltaPagar?: number }): Reserva {
  const all = load();
  const now = new Date().toISOString();
  const hospedagem = isHospedagemReserva(data.clientId, data.tipo);
  const pessoas = (hospedagem
    ? semPagamentoIndividual(data.pessoas ?? [])
    : pessoasComPagamentos(data.pessoas ?? [], data.valorPago))
    .map(normalizarConsumoPessoa);
  const totalPessoas = somarValorPessoas(pessoas);
  const usarTotalPessoas = pessoas.some((p) => p.valor > 0) || (pessoas.length > 0 && pessoas.every((p) => p.gratuito));
  const valorTotal = hospedagem
    ? Math.max(round2(data.valorTotal), 0)
    : (usarTotalPessoas ? totalPessoas : Math.max(round2(data.valorTotal), 0));
  const valorPago = Math.min(
    !hospedagem && totalPessoas > 0 ? somarValorPagoPessoas(pessoas) : Math.max(round2(data.valorPago), 0),
    valorTotal,
  );
  // faltaPagar sempre derivado server-side — ignora qualquer valor explícito
  // do caller, pra nunca deixar o arquivo salvar um valor incoerente.
  const faltaPagar = Math.max(round2(valorTotal - valorPago), 0);
  const status = statusPorPagamentos(data.status, valorTotal, valorPago);
  const r: Reserva = { ...data, pessoas, valorTotal, valorPago, faltaPagar, status, id: randomUUID(), createdAt: now, updatedAt: now };
  all.push(r);
  save(all);
  return r;
}

export function updateReserva(id: string, patch: Partial<Omit<Reserva, "id" | "clientId" | "createdAt">>): Reserva | null {
  const all = load();
  const idx = all.findIndex((r) => r.id === id);
  if (idx < 0) return null;
  const current = normalizarReserva(all[idx]);
  const tipoFinal = patch.tipo ?? current.tipo;
  const hospedagem = isHospedagemReserva(current.clientId, tipoFinal);
  let pessoas = current.pessoas;

  if (patch.pessoas) {
    const pessoasComConsumo = preservarConsumoExistente(patch.pessoas, current.pessoas);
    pessoas = (hospedagem
      ? semPagamentoIndividual(pessoasComConsumo)
      : temPagamentosIndividuais(pessoasComConsumo)
        ? normalizarPagamentosIndividuais(pessoasComConsumo)
        : distribuirPagamentoPelasPessoas(pessoasComConsumo, patch.valorPago ?? current.valorPago))
      .map(normalizarConsumoPessoa);
  } else if (!hospedagem && patch.valorPago !== undefined) {
    pessoas = distribuirPagamentoPelasPessoas(current.pessoas, patch.valorPago).map(normalizarConsumoPessoa);
  } else if (hospedagem) {
    pessoas = semPagamentoIndividual(current.pessoas).map(normalizarConsumoPessoa);
  }

  const totalPessoas = somarValorPessoas(pessoas);
  const usarTotalPessoas = !hospedagem && !!patch.pessoas
    && (pessoas.some((p) => p.valor > 0) || (pessoas.length > 0 && pessoas.every((p) => p.gratuito)));
  const valorTotal = Math.max(usarTotalPessoas ? totalPessoas : round2(patch.valorTotal ?? current.valorTotal), 0);
  const valorPago = Math.min(
    !hospedagem && totalPessoas > 0
      ? somarValorPagoPessoas(pessoas)
      : Math.max(round2(patch.valorPago ?? current.valorPago), 0),
    valorTotal,
  );
  const status = statusPorPagamentos(patch.status ?? current.status, valorTotal, valorPago);
  const merged = {
    ...all[idx],
    ...patch,
    pessoas,
    valorTotal,
    valorPago,
    status,
    updatedAt: new Date().toISOString(),
  };
  // Recalcula faltaPagar a partir do valorTotal/valorPago finais em vez de
  // aceitar o que veio no patch — evita que uma edição parcial (ex: só
  // valorPago) deixe faltaPagar dessincronizado no arquivo.
  merged.faltaPagar = Math.max(round2(merged.valorTotal - merged.valorPago), 0);
  all[idx] = merged;
  save(all);
  return merged;
}

// "Excluir" arquiva em vez de apagar de verdade — os dados continuam contando
// pra relatórios/histórico (pedido explícito: nunca perder dado de reserva
// passada), só somem das listas ativas. Nunca remove a linha do arquivo.
export function deleteReserva(id: string): boolean {
  const all = load();
  const idx = all.findIndex((r) => r.id === id);
  if (idx < 0) return false;
  all[idx] = { ...all[idx], arquivada: true, updatedAt: new Date().toISOString() };
  save(all);
  return true;
}

// Equivalente interno do antigo findLastRowByPhone (google-sheets.ts) — usado
// pelo extrator da IA pra dedupe de inserção e lookup de confirmação de pagamento.
// Se "data" for informada, só considera a MESMA reserva quando a data também
// bater — evita tratar uma reserva NOVA (ex: mesma pessoa reservando o Day
// Use de outro fim de semana) como se fosse atualização de uma reserva
// antiga do mesmo telefone/tipo; e evita marcar a MESMA data duas vezes.
export function findReservaByPhone(clientId: string, phone: string, tipo?: string, data?: string): Reserva | undefined {
  const digits = phone.replace(/\D/g, "").slice(-8);
  if (!digits) return undefined;
  let rows = getReservas(clientId).filter((r) => (r.telefone ?? "").replace(/\D/g, "").endsWith(digits));
  if (tipo) rows = rows.filter((r) => r.tipo === tipo);
  if (data) rows = rows.filter((r) => r.data === data);
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
    .filter((r) => r.quarto && !r.arquivada && r.status !== "cancelada")
    .filter((r) => data >= r.data && data <= (r.dataCheckout ?? r.data))
    .map((r) => ({ quarto: r.quarto!, reserva: r }));
}

// Reservas (com quarto) que ocupam QUALQUER dia do intervalo [dataInicio,
// dataFim] — usado tanto pelo seletor visual de quarto no modal de reserva
// quanto por quartosOcupadosNoPeriodo/atribuirQuartoLivre abaixo.
// excludeId permite ignorar a própria reserva sendo editada, senão ela
// apareceria "ocupando" o quarto que já é dela mesma.
export function getOcupacaoPorPeriodo(
  clientId: string,
  dataInicio: string,
  dataFim: string,
  excludeId?: string,
): OcupacaoQuarto[] {
  return getReservas(clientId)
    .filter((r) => r.quarto && !r.arquivada && r.status !== "cancelada" && r.id !== excludeId)
    // Dois intervalos se sobrepõem se início de um <= fim do outro nos dois sentidos.
    .filter((r) => dataInicio <= (r.dataCheckout ?? r.data) && dataFim >= r.data)
    .map((r) => ({ quarto: r.quarto!, reserva: r }));
}

// Quartos ocupados em QUALQUER dia do intervalo [dataInicio, dataFim] — usado
// pra achar o primeiro quarto livre pro período todo da nova reserva, não só
// pra um dia isolado (ver atribuirQuartoLivre).
function quartosOcupadosNoPeriodo(clientId: string, dataInicio: string, dataFim: string): Set<string> {
  return new Set(getOcupacaoPorPeriodo(clientId, dataInicio, dataFim).map((o) => o.quarto));
}

// Atribui automaticamente o primeiro quarto/chalé livre (1..totalQuartos) pro
// período da reserva — sem isso, reservas fechadas pela IA nunca tinham
// número de quarto (ficava "pra equipe decidir depois") e por isso nunca
// apareciam na tela de Ocupação. Retorna undefined se não há quarto livre ou
// se o cliente não tem total de quartos configurado.
export function atribuirQuartoLivre(
  clientId: string,
  totalQuartos: number,
  dataInicio: string,
  dataFim: string,
): string | undefined {
  if (totalQuartos <= 0) return undefined;
  const ocupados = quartosOcupadosNoPeriodo(clientId, dataInicio, dataFim);
  for (let i = 1; i <= totalQuartos; i++) {
    const quarto = String(i);
    if (!ocupados.has(quarto)) return quarto;
  }
  return undefined;
}

export function calcularTotais(reservas: Reserva[]) {
  const acc = reservas.reduce(
    (acc, r) => ({
      valorTotal: acc.valorTotal + r.valorTotal,
      valorPago: acc.valorPago + r.valorPago,
      faltaPagar: acc.faltaPagar + r.faltaPagar,
      totalPessoas: acc.totalPessoas + r.pessoas.length,
    }),
    { valorTotal: 0, valorPago: 0, faltaPagar: 0, totalPessoas: 0 }
  );
  return {
    valorTotal: round2(acc.valorTotal),
    valorPago: round2(acc.valorPago),
    faltaPagar: round2(acc.faltaPagar),
    totalPessoas: acc.totalPessoas,
  };
}
