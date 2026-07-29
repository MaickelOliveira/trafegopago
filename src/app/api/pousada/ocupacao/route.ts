import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getClientById } from "@/lib/clients";
import { getOcupacaoPorData, getOcupacaoPorPeriodo } from "@/lib/pousada";

// GET /api/pousada/ocupacao?clientId=&data=AAAA-MM-DD — quartos ocupados numa data.
// Com &dataFim=AAAA-MM-DD, verifica o PERÍODO inteiro [data, dataFim] em vez de
// um dia isolado — usado pelo seletor de quarto no modal de reserva, já que uma
// hospedagem de várias diárias precisa saber se algum dia do intervalo bate com
// outra reserva, não só o check-in. &excludeId ignora uma reserva específica
// (a que está sendo editada), senão ela apareceria ocupando o próprio quarto.
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const clientId = req.nextUrl.searchParams.get("clientId") ?? session.clientId;
  if (!clientId) return NextResponse.json({ error: "clientId obrigatório" }, { status: 400 });
  if (session.role !== "manager" && session.clientId !== clientId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const data = req.nextUrl.searchParams.get("data") ?? new Date().toISOString().slice(0, 10);
  const dataFim = req.nextUrl.searchParams.get("dataFim") ?? undefined;
  const excludeId = req.nextUrl.searchParams.get("excludeId") ?? undefined;

  const client = getClientById(clientId);
  if (!client) return NextResponse.json({ error: "Cliente não encontrado" }, { status: 404 });

  const ocupados = dataFim
    ? getOcupacaoPorPeriodo(clientId, data, dataFim, excludeId)
    : getOcupacaoPorData(clientId, data);
  return NextResponse.json({ totalQuartos: client.pousadaTotalQuartos ?? 0, data, ocupados });
}
