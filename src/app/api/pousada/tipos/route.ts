import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getClientById, upsertClient } from "@/lib/clients";
import { TIPOS_PADRAO, type PousadaTipo } from "@/lib/pousada-types";

// GET /api/pousada/tipos?clientId=xxx — lista os tipos de reserva configurados
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

  return NextResponse.json(client.pousadaTipos?.length ? client.pousadaTipos : TIPOS_PADRAO);
}

// PUT /api/pousada/tipos — { clientId, tipos } — gestor ou o próprio cliente podem editar
export async function PUT(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const clientId: string | undefined = body.clientId ?? session.clientId;
  const tipos: PousadaTipo[] | undefined = body.tipos;

  if (!clientId) return NextResponse.json({ error: "clientId obrigatório" }, { status: 400 });
  if (!Array.isArray(tipos)) return NextResponse.json({ error: "tipos deve ser um array" }, { status: 400 });

  if (session.role !== "manager" && session.clientId !== clientId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const client = getClientById(clientId);
  if (!client) return NextResponse.json({ error: "Cliente não encontrado" }, { status: 404 });

  upsertClient({ ...client, pousadaTipos: tipos });
  return NextResponse.json({ ok: true, tipos });
}
