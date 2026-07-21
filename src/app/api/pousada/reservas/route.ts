import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import {
  getReservasFiltradas,
  createReserva,
  calcularFaixasEtarias,
  calcularTotais,
} from "@/lib/pousada";

// GET /api/pousada/reservas?clientId=&tipo=&from=&to= — lista/filtra reservas
// e devolve também as faixas etárias e totais já computados
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const clientId = req.nextUrl.searchParams.get("clientId") ?? session.clientId;
  if (!clientId) return NextResponse.json({ error: "clientId obrigatório" }, { status: 400 });

  if (session.role !== "manager" && session.clientId !== clientId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const tipo = req.nextUrl.searchParams.get("tipo") ?? undefined;
  const dataInicio = req.nextUrl.searchParams.get("from") ?? undefined;
  const dataFim = req.nextUrl.searchParams.get("to") ?? undefined;

  const reservas = getReservasFiltradas(clientId, { tipo, dataInicio, dataFim });

  return NextResponse.json({
    reservas,
    faixasEtarias: calcularFaixasEtarias(reservas),
    totais: calcularTotais(reservas),
  });
}

// POST /api/pousada/reservas — cria reserva manual (origem sempre "manual",
// nunca aceito do corpo da requisição, pra não ser falsificado)
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const clientId: string | undefined = body.clientId ?? session.clientId;
  if (!clientId) return NextResponse.json({ error: "clientId obrigatório" }, { status: 400 });

  if (session.role !== "manager" && session.clientId !== clientId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { tipo, data, dataCheckout, quarto, hora, responsavel, telefone, pessoas, valorTotal, valorPago, status, cidade, observacoes } = body;

  if (!tipo || !data || !responsavel?.nome || !Array.isArray(pessoas)) {
    return NextResponse.json({ error: "Campos obrigatórios: tipo, data, responsavel.nome, pessoas" }, { status: 400 });
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
    status: status ?? "pendente",
    cidade,
    observacoes,
    origem: "manual",
  });

  return NextResponse.json(reserva);
}
