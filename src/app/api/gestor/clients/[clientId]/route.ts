import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getClientById, upsertClient, deleteClient } from "@/lib/clients";
import bcrypt from "bcryptjs";

type Params = { params: Promise<{ clientId: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const session = await getSession();
  if (!session || session.role !== "manager") {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }
  const { clientId } = await params;
  const client = getClientById(clientId);
  if (!client) return NextResponse.json({ error: "Cliente não encontrado" }, { status: 404 });
  const { passwordHash: _, ...safe } = client;
  return NextResponse.json(safe);
}

export async function PUT(req: NextRequest, { params }: Params) {
  const session = await getSession();
  if (!session || session.role !== "manager") {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }
  const { clientId } = await params;
  const existing = getClientById(clientId);
  if (!existing) return NextResponse.json({ error: "Cliente não encontrado" }, { status: 404 });

  const body = await req.json();
  const updated = {
    ...existing,
    ...body,
    id: clientId,
    passwordHash: body.password
      ? bcrypt.hashSync(body.password, 10)
      : existing.passwordHash,
  };
  delete updated.password;
  upsertClient(updated);
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req2: NextRequest, { params }: Params) {
  const session = await getSession();
  if (!session || session.role !== "manager") {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }
  const { clientId } = await params;
  deleteClient(clientId);
  return NextResponse.json({ ok: true });
}
