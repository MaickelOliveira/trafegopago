import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getTransacoes, getTransacoesMes, createTransacao, getHistoricoMeses, calcularResumo } from "@/lib/financeiro";

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "manager") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = req.nextUrl;
  const ano = parseInt(searchParams.get("ano") ?? String(new Date().getFullYear()));
  const mes = parseInt(searchParams.get("mes") ?? String(new Date().getMonth() + 1));

  const transacoes = getTransacoesMes(ano, mes);
  const resumo = calcularResumo(transacoes);
  const historico = getHistoricoMeses(6);
  const todas = getTransacoes();

  return NextResponse.json({ transacoes, resumo, historico, totalTransacoes: todas.length });
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "manager") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const t = createTransacao({
    tipo: body.tipo,
    categoria: body.categoria,
    descricao: body.descricao,
    valor: Number(body.valor),
    data: body.data,
    clientId: body.clientId || null,
    recorrente: body.recorrente ?? false,
    diaVencimento: body.diaVencimento ? Number(body.diaVencimento) : null,
    status: body.status ?? "pago",
  });
  return NextResponse.json(t, { status: 201 });
}
