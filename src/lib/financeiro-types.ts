export type TipoTransacao = "receita" | "despesa";
export type StatusTransacao = "pago" | "pendente" | "atrasado";

export const CATEGORIAS_RECEITA = [
  "Mensalidade",
  "Projeto avulso",
  "Consultoria",
  "Bônus / upsell",
  "Outro",
] as const;

export const CATEGORIAS_DESPESA = [
  "Ferramenta / SaaS",
  "Hospedagem / Servidor",
  "Tráfego próprio",
  "Freelancer / Terceiro",
  "Salário",
  "Imposto",
  "Outro",
] as const;

export type Transacao = {
  id: string;
  tipo: TipoTransacao;
  categoria: string;
  descricao: string;
  valor: number;
  data: string;
  clientId: string | null;
  recorrente: boolean;
  diaVencimento: number | null;
  status: StatusTransacao;
  createdAt: string;
};

export type ResumoMes = {
  totalReceitas: number;
  totalDespesas: number;
  lucro: number;
  margem: number;
  receitasPorCategoria: Record<string, number>;
  despesasPorCategoria: Record<string, number>;
  receitasPorCliente: Record<string, number>;
  pendentes: number;
  atrasados: number;
};
