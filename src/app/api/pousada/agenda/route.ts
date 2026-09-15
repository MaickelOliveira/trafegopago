import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getClientById } from "@/lib/clients";
import { createEventoAgenda, getEventosAgenda } from "@/lib/pousada-agenda";
import { normalizarPousadaTipo, TIPOS_PADRAO } from "@/lib/pousada-types";

function isISODate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function isTime(value: unknown): value is string {
  return typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const clientId = req.nextUrl.searchParams.get("clientId") ?? session.clientId;
  if (!clientId) return NextResponse.json({ error: "clientId obrigatório" }, { status: 400 });
  if (session.role !== "manager" && session.clientId !== clientId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const from = req.nextUrl.searchParams.get("from");
  const to = req.nextUrl.searchParams.get("to");
  let eventos = getEventosAgenda(clientId);
  if (from) eventos = eventos.filter((evento) => evento.data >= from);
  if (to) eventos = eventos.filter((evento) => evento.data <= to);
  return NextResponse.json({ eventos });
}

export async function POST(req: NextRequest) {
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

  const titulo = typeof body.titulo === "string" ? body.titulo.trim() : "";
  const tipo = typeof body.tipo === "string" ? body.tipo : "evento_geral";
  if (!titulo || !isISODate(body.data)) {
    return NextResponse.json({ error: "Título e data são obrigatórios" }, { status: 400 });
  }
  if (body.hora && !isTime(body.hora)) {
    return NextResponse.json({ error: "Horário inválido" }, { status: 400 });
  }

  const tipos = (client.pousadaTipos?.length ? client.pousadaTipos : TIPOS_PADRAO)
    .map(normalizarPousadaTipo);
  const tipoValido = tipo === "evento_geral"
    || tipos.some((item) => item.slug === tipo && item.ativo !== false && item.categoria === "evento");
  if (!tipoValido) {
    return NextResponse.json({ error: "Selecione um tipo de evento ativo" }, { status: 400 });
  }

  const evento = createEventoAgenda({
    clientId,
    tipo,
    titulo,
    data: body.data,
    hora: body.hora || undefined,
    observacoes: typeof body.observacoes === "string" ? body.observacoes : undefined,
  });
  return NextResponse.json(evento, { status: 201 });
}
