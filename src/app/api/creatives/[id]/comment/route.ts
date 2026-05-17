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

  if (session.role === "client" && session.clientId !== creative.clientId) {
    return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  }

  const { text } = await req.json();
  if (!text?.trim()) return NextResponse.json({ error: "Comentário vazio" }, { status: 400 });

  updateCreative({
    ...creative,
    comments: [
      ...creative.comments,
      { by: session.role, text: text.trim(), at: new Date().toISOString() },
    ],
  });

  return NextResponse.json({ ok: true });
}
