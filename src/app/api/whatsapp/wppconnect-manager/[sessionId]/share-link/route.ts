import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { createShareLink, getActiveShareLinkForSession } from "@/lib/wpp-share-links";
import { getWppSessionById } from "@/lib/wppconnect-sessions";

/**
 * POST /api/whatsapp/wppconnect-manager/[sessionId]/share-link — gera (ou
 * retorna o já ativo) um link público que abre a tela de QR sem precisar de
 * login, pra enviar a quem tem o celular físico. `force=true` revoga o link
 * ativo e gera um novo.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const session = await getSession();
  if (!session || session.role !== "manager") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { sessionId } = await params;
  const wppSession = getWppSessionById(sessionId);
  if (!wppSession) return NextResponse.json({ error: "Sessão não encontrada" }, { status: 404 });

  const body = await req.json().catch(() => ({})) as { force?: boolean };

  const existing = !body.force ? getActiveShareLinkForSession(sessionId) : undefined;
  const link = existing ?? createShareLink(sessionId);

  return NextResponse.json({ token: link.id });
}
