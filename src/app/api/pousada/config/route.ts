import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getClientById, upsertClient } from "@/lib/clients";

// GET /api/pousada/config?clientId=xxx — configurações gerais do sistema de Pousada (hoje: total de quartos/chalés)
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const clientId = req.nextUrl.searchParams.get("clientId") ?? session.clientId;
  if (!clientId) return NextResponse.json({ error: "clientId obrigatório" }, { status: 400 });
  if (session.role !== "manager" && session.clientId !== clientId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const client = getClientById(clientId);
  if (!client) return NextResponse.json({ error: "Cliente não encontrado" }, { status: 404 });

  return NextResponse.json({ totalQuartos: client.pousadaTotalQuartos ?? 0 });
}

// PUT /api/pousada/config — { clientId, totalQuartos }
export async function PUT(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const clientId: string | undefined = body.clientId ?? session.clientId;
  const totalQuartos = Number(body.totalQuartos);

  if (!clientId) return NextResponse.json({ error: "clientId obrigatório" }, { status: 400 });
  if (!Number.isFinite(totalQuartos) || totalQuartos < 0) {
    return NextResponse.json({ error: "totalQuartos inválido" }, { status: 400 });
  }
  if (session.role !== "manager" && session.clientId !== clientId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const client = getClientById(clientId);
  if (!client) return NextResponse.json({ error: "Cliente não encontrado" }, { status: 404 });

  upsertClient({ ...client, pousadaTotalQuartos: totalQuartos });
  return NextResponse.json({ ok: true, totalQuartos });
}
