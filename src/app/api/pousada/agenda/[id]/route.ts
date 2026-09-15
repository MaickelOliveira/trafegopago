import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getClientById } from "@/lib/clients";
import {
  archiveEventoAgenda,
  getEventoAgendaById,
  updateEventoAgenda,
} from "@/lib/pousada-agenda";
import { normalizarPousadaTipo, TIPOS_PADRAO } from "@/lib/pousada-types";

type Params = { params: Promise<{ id: string }> };

function isISODate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function isTime(value: unknown): value is string {
  return typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

export async function PUT(req: NextRequest, { params }: Params) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const existing = getEventoAgendaById(id);
  if (!existing || existing.arquivado) {
    return NextResponse.json({ error: "Evento não encontrado" }, { status: 404 });
  }
  if (session.role !== "manager" && session.clientId !== existing.clientId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const titulo = typeof body.titulo === "string" ? body.titulo.trim() : "";
  const tipo = typeof body.tipo === "string" ? body.tipo : "evento_geral";
  if (!titulo || !isISODate(body.data)) {
    return NextResponse.json({ error: "Título e data são obrigatórios" }, { status: 400 });
  }
  if (body.hora && !isTime(body.hora)) {
    return NextResponse.json({ error: "Horário inválido" }, { status: 400 });
  }

  const client = getClientById(existing.clientId);
  const tipos = (client?.pousadaTipos?.length ? client.pousadaTipos : TIPOS_PADRAO)
    .map(normalizarPousadaTipo);
  const tipoValido = tipo === "evento_geral"
    || tipos.some((item) => item.slug === tipo && item.ativo !== false && item.categoria === "evento");
  if (!tipoValido) {
    return NextResponse.json({ error: "Selecione um tipo de evento ativo" }, { status: 400 });
  }

  const evento = updateEventoAgenda(id, {
    tipo,
    titulo,
    data: body.data,
    hora: body.hora || undefined,
    observacoes: typeof body.observacoes === "string" ? body.observacoes : undefined,
  });
  return NextResponse.json(evento);
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const existing = getEventoAgendaById(id);
  if (!existing || existing.arquivado) {
    return NextResponse.json({ error: "Evento não encontrado" }, { status: 404 });
  }
  if (session.role !== "manager" && session.clientId !== existing.clientId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  archiveEventoAgenda(id);
  return NextResponse.json({ ok: true });
}
