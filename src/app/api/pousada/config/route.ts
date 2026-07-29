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

  return NextResponse.json({
    totalQuartos: client.pousadaTotalQuartos ?? 0,
    pixChave: client.pousadaPixChave ?? "",
    pixFavorecido: client.pousadaPixFavorecido ?? "",
  });
}

// PUT /api/pousada/config — { clientId, totalQuartos?, pixChave?, pixFavorecido? }
export async function PUT(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const clientId: string | undefined = body.clientId ?? session.clientId;

  if (!clientId) return NextResponse.json({ error: "clientId obrigatório" }, { status: 400 });
  if (session.role !== "manager" && session.clientId !== clientId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const client = getClientById(clientId);
  if (!client) return NextResponse.json({ error: "Cliente não encontrado" }, { status: 404 });

  const patch: { pousadaTotalQuartos?: number; pousadaPixChave?: string; pousadaPixFavorecido?: string } = {};
  if (body.totalQuartos !== undefined) {
    const totalQuartos = Number(body.totalQuartos);
    if (!Number.isFinite(totalQuartos) || totalQuartos < 0) {
      return NextResponse.json({ error: "totalQuartos inválido" }, { status: 400 });
    }
    patch.pousadaTotalQuartos = totalQuartos;
  }
  if (body.pixChave !== undefined) patch.pousadaPixChave = String(body.pixChave);
  if (body.pixFavorecido !== undefined) patch.pousadaPixFavorecido = String(body.pixFavorecido);

  upsertClient({ ...client, ...patch });
  return NextResponse.json({
    ok: true,
    totalQuartos: patch.pousadaTotalQuartos ?? client.pousadaTotalQuartos ?? 0,
    pixChave: patch.pousadaPixChave ?? client.pousadaPixChave ?? "",
    pixFavorecido: patch.pousadaPixFavorecido ?? client.pousadaPixFavorecido ?? "",
  });
}
