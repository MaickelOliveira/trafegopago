import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getCreativeById, updateCreative } from "@/lib/creatives";

type Params = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 403 });

  const { id } = await params;
  const creative = getCreativeById(id);
  if (!creative) return NextResponse.json({ error: "Criativo não encontrado" }, { status: 404 });

  // Garante que só o destinatário pode aprovar/rejeitar
  const isRecipient =
    (creative.sentBy === "manager" && session.role === "client" && session.clientId === creative.clientId) ||
    (creative.sentBy === "client" && session.role === "manager");

  if (!isRecipient) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  const { status, comment } = await req.json();
  if (status !== "approved" && status !== "rejected") {
    return NextResponse.json({ error: "Status inválido" }, { status: 400 });
  }
  if (status === "rejected" && !comment) {
    return NextResponse.json({ error: "Informe o motivo da rejeição" }, { status: 400 });
  }

  updateCreative({
    ...creative,
    status,
    rejectionComment: status === "rejected" ? comment : null,
    comments: comment
      ? [...creative.comments, { by: session.role, text: comment, at: new Date().toISOString() }]
      : creative.comments,
  });

  return NextResponse.json({ ok: true, status });
}
