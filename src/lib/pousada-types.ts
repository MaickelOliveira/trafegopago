export type StatusReserva = "pendente" | "parcial" | "pago" | "cancelada";
export type OrigemReserva = "ia" | "manual";

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
  gratuito?: boolean;
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
  createdAt: string;
  updatedAt: string;
};

// "hospedagem" tem campos próprios (quarto/chalé, check-in/check-out, CPF de
// cada hóspede) — "evento" é pra day use, almoço e eventos esporádicos, que só
// precisam nome/idade/cidade de cada participante. Controla qual formulário
// e quais colunas o dashboard mostra pra cada tipo.
export type CategoriaTipo = "hospedagem" | "evento";

export type PousadaTipo = { slug: string; label: string; categoria?: CategoriaTipo };

export type FaixaEtariaResumo = { faixa0a5: number; faixa6a12: number };

export const TIPOS_PADRAO: PousadaTipo[] = [
  { slug: "hospedagem", label: "Hospedagem", categoria: "hospedagem" },
  { slug: "day_use", label: "Day Use", categoria: "evento" },
  { slug: "almoco", label: "Almoço", categoria: "evento" },
];
