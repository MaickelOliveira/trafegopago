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

export type PousadaTipo = { slug: string; label: string; categoria?: CategoriaTipo };

function normalizarIdentificadorTipo(valor: string): string {
  return valor
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

/**
 * Hospedagem e serviços corporativos são vendidos pelo valor total do pacote.
 * A categoria continua separada: um corporativo ainda usa os campos de evento
 * (nome, telefone, idade e cidade), sem ganhar quarto, check-in ou CPF.
 */
export function tipoUsaValorPorPacote(
  tipo: Pick<PousadaTipo, "slug" | "label" | "categoria"> | string | null | undefined,
): boolean {
  if (!tipo) return false;
  if (typeof tipo !== "string" && tipo.categoria === "hospedagem") return true;

  const identificador = typeof tipo === "string"
    ? tipo
    : `${tipo.slug} ${tipo.label}`;
  return /hospedagem|pernoite|diaria|corporativ/.test(normalizarIdentificadorTipo(identificador));
}

export type FaixaEtariaResumo = { faixa0a5: number; faixa6a12: number };

export const TIPOS_PADRAO: PousadaTipo[] = [
  { slug: "hospedagem", label: "Hospedagem", categoria: "hospedagem" },
  { slug: "day_use", label: "Day Use", categoria: "evento" },
  { slug: "almoco", label: "Almoço", categoria: "evento" },
];
