import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getClientById } from "@/lib/clients";
import { getOcupacaoPorData } from "@/lib/pousada";

// GET /api/pousada/ocupacao?clientId=&data=AAAA-MM-DD — quartos ocupados numa data
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const clientId = req.nextUrl.searchParams.get("clientId") ?? session.clientId;
  if (!clientId) return NextResponse.json({ error: "clientId obrigatório" }, { status: 400 });
  if (session.role !== "manager" && session.clientId !== clientId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const data = req.nextUrl.searchParams.get("data") ?? new Date().toISOString().slice(0, 10);

  const client = getClientById(clientId);
  if (!client) return NextResponse.json({ error: "Cliente não encontrado" }, { status: 404 });

  const ocupados = getOcupacaoPorData(clientId, data);
  return NextResponse.json({ totalQuartos: client.pousadaTotalQuartos ?? 0, data, ocupados });
}
