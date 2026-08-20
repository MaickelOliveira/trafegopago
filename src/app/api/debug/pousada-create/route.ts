import { NextRequest, NextResponse } from "next/server";
import { createReserva } from "@/lib/pousada";
import type { Pessoa } from "@/lib/pousada-types";

export const dynamic = "force-dynamic";

// Recuperação manual pontual: cria 1 reserva a partir de dados já confirmados
// (ex: formulário preenchido pelo hóspede, mas que não virou reserva por causa
// de algum bug na extração automática — ver tryChargeMessage em
// guest-forms/[token]/route.ts). Mesmo padrão sem auth de pousada-import
// (debug tools são só-leitura por padrão, exceto essas duas migrações
// pontuais rodadas manualmente via curl/fetch, nunca de uso contínuo).
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { clientId, tipo, data, dataCheckout, quarto, hora, responsavel, telefone, pessoas, valorTotal, valorPago, status, cidade, observacoes } = body as {
    clientId?: string; tipo?: string; data?: string; dataCheckout?: string; quarto?: string; hora?: string;
    responsavel?: { nome: string; cpf?: string }; telefone?: string; pessoas?: Pessoa[];
    valorTotal?: number; valorPago?: number; status?: string; cidade?: string; observacoes?: string;
  };

  if (!clientId || !tipo || !data || !responsavel?.nome || !Array.isArray(pessoas)) {
    return NextResponse.json({ error: "Campos obrigatórios: clientId, tipo, data, responsavel.nome, pessoas" }, { status: 400 });
  }

  const reserva = createReserva({
    clientId,
    tipo,
    data,
    dataCheckout,
    quarto,
    hora,
    responsavel,
    telefone,
    pessoas,
    valorTotal: valorTotal ?? 0,
    valorPago: valorPago ?? 0,
    status: (status as import("@/lib/pousada-types").StatusReserva) ?? "pendente",
    cidade,
    observacoes,
    origem: "manual",
  });

  return NextResponse.json(reserva);
}
