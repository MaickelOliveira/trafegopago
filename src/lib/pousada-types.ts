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
  data: string; // ISO date
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

export type PousadaTipo = { slug: string; label: string };

export type FaixaEtariaResumo = { faixa0a5: number; faixa6a12: number };

export const TIPOS_PADRAO: PousadaTipo[] = [
  { slug: "hospedagem", label: "Hospedagem" },
  { slug: "day_use", label: "Day Use" },
  { slug: "almoco", label: "Almoço" },
];
