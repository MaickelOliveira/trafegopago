export type StatusReserva = "pendente" | "parcial" | "pago" | "cancelada" | "cortesia";
export type OrigemReserva = "ia" | "manual";

export type LocalItemConsumo = "frigobar" | "quarto";

export type ItemConsumoHospede = {
  id: string;
  nome: string;
  local: LocalItemConsumo;
  quantidadeColocada: number;
  quantidadeConsumida: number;
  valorUnitario: number;
};

export type Pessoa = {
  nome: string;
  idade?: number;
  cpf?: string;
  rg?: string;
  nascimento?: string; // ISO date
  endereco?: string;
  cidade?: string;
  telefone?: string;
  email?: string;
  profissao?: string;
  valor: number;
  valorPago?: number; // pagamento atribuído a esta pessoa; saldo é derivado de valor - valorPago
  gratuito?: boolean;
  compareceu?: boolean;
  itensConsumo?: ItemConsumoHospede[];
  consumoConferido?: boolean;
  consumoConferidoEm?: string; // ISO datetime da última conferência finalizada
};

export type Reserva = {
  id: string;
  clientId: string;
  tipo: string; // slug — referencia client.pousadaTipos[].slug
  // Fotografia do modelo de cobrança usado quando a reserva foi criada. Isso
  // impede que uma alteração posterior no cadastro do serviço mude o
  // financeiro de reservas antigas.
  cobranca?: CobrancaTipo;
  data: string; // ISO date — check-in, no caso de hospedagem/pernoite
  dataCheckout?: string; // ISO date — só reservas com pernoite (hospedagem); ausente = evento de um dia só
  quarto?: string; // número/nome do quarto ou chalé (ex: "12"), só hospedagem
  hora?: string; // HH:MM
  responsavel: { nome: string; cpf?: string };
  telefone?: string; // contato para lookup/atualização por telefone
  pessoas: Pessoa[];
  valorTotal: number;
  valorPago: number;
  faltaPagar: number;
  status: StatusReserva;
  cidade?: string;
  observacoes?: string;
  origem: OrigemReserva;
  // "Excluir" na tela de reserva arquiva em vez de apagar — os dados continuam
  // valendo pra relatórios/histórico, só somem das listas ativas (dashboard,
  // ocupação, próximas reservas).
  arquivada?: boolean;
  createdAt: string;
  updatedAt: string;
};

// "hospedagem" tem campos próprios (quarto/chalé, check-in/check-out, CPF de
// cada hóspede) — "evento" é pra day use, almoço e eventos esporádicos, que só
// precisam nome/idade/cidade de cada participante. Controla qual formulário
// e quais colunas o dashboard mostra pra cada tipo.
export type CategoriaTipo = "hospedagem" | "evento";
export type CobrancaTipo = "individual" | "lote";

export type PousadaTipo = {
  slug: string;
  label: string;
  categoria?: CategoriaTipo;
  cobranca?: CobrancaTipo;
  // Tipos removidos da operação permanecem arquivados para que o nome, a
  // categoria e a cobrança continuem disponíveis nos relatórios históricos.
  ativo?: boolean;
};

function normalizarIdentificadorTipo(valor: string): string {
  return valor
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

/**
 * Hospedagem, Corporativo e Casamento/Fotos são sempre cobrados em lote. Nos
 * demais tipos, a configuração explícita prevalece; cadastros antigos ainda
 * sem `cobranca` continuam individuais.
 */
export function tipoUsaValorPorPacote(
  tipo: Pick<PousadaTipo, "slug" | "label" | "categoria" | "cobranca"> | string | null | undefined,
): boolean {
  if (!tipo) return false;
  if (tipoExigeValorPorPacote(tipo)) return true;
  return typeof tipo !== "string" && tipo.cobranca === "lote";
}

export function tipoExigeValorPorPacote(
  tipo: Pick<PousadaTipo, "slug" | "label" | "categoria"> | string | null | undefined,
): boolean {
  if (!tipo) return false;
  if (typeof tipo !== "string" && tipo.categoria === "hospedagem") return true;

  const identificador = typeof tipo === "string"
    ? tipo
    : `${tipo.slug} ${tipo.label}`;
  return /hospedagem|pernoite|diaria|corporativ|casamento|fotos?/.test(normalizarIdentificadorTipo(identificador));
}

export function normalizarPousadaTipo(tipo: PousadaTipo): PousadaTipo {
  return {
    ...tipo,
    categoria: tipo.categoria ?? "evento",
    cobranca: tipoExigeValorPorPacote(tipo)
      ? "lote"
      : tipo.cobranca ?? "individual",
    ativo: tipo.ativo !== false,
  };
}

/**
 * Salva a lista ativa sem apagar os tipos removidos. Os removidos ficam
 * inativos e podem voltar a aparecer se o mesmo slug for cadastrado de novo.
 */
export function mesclarTiposComHistorico(
  tiposAtuais: PousadaTipo[],
  tiposAtivos: PousadaTipo[],
): PousadaTipo[] {
  const ativosNormalizados = tiposAtivos.map((tipo) => normalizarPousadaTipo({ ...tipo, ativo: true }));
  const slugsAtivos = new Set(ativosNormalizados.map((tipo) => tipo.slug));
  const historicos = tiposAtuais
    .filter((tipo) => !slugsAtivos.has(tipo.slug))
    .map((tipo) => normalizarPousadaTipo({ ...tipo, ativo: false }));

  return [...ativosNormalizados, ...historicos];
}

export type FaixaEtariaResumo = { faixa0a5: number; faixa6a12: number };

export const TIPOS_PADRAO: PousadaTipo[] = [
  { slug: "hospedagem", label: "Hospedagem", categoria: "hospedagem", cobranca: "lote", ativo: true },
  { slug: "day_use", label: "Day Use", categoria: "evento", cobranca: "individual", ativo: true },
  { slug: "almoco", label: "Almoço", categoria: "evento", cobranca: "individual", ativo: true },
];
