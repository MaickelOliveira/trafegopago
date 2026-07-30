import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getReservaById, updateReserva, deleteReserva } from "@/lib/pousada";
import { getClientById } from "@/lib/clients";

type Params = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: Params) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const reserva = getReservaById(id);
  if (!reserva) return NextResponse.json({ error: "Reserva não encontrada" }, { status: 404 });

  if (session.role !== "manager" && session.clientId !== reserva.clientId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // clientName usado pra trocar o título da aba/impressão (mostra o nome do
  // cliente, ex: "Vítallí Garden", em vez do nome fixo da plataforma) — ver
  // PousadaReservaDetailView.tsx.
  const clientName = getClientById(reserva.clientId)?.name;
  return NextResponse.json({ ...reserva, clientName });
}

export async function PUT(req: NextRequest, { params }: Params) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const existing = getReservaById(id);
  if (!existing) return NextResponse.json({ error: "Reserva não encontrada" }, { status: 404 });

  if (session.role !== "manager" && session.clientId !== existing.clientId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  // clientId/origem/id nunca são editáveis via PUT
  const { clientId: _clientId, origem: _origem, id: _id, ...patch } = body;
  const updated = updateReserva(id, patch);

  return NextResponse.json(updated);
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const existing = getReservaById(id);
  if (!existing) return NextResponse.json({ error: "Reserva não encontrada" }, { status: 404 });

  if (session.role !== "manager" && session.clientId !== existing.clientId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const ok = deleteReserva(id);
  return NextResponse.json({ ok });
}
