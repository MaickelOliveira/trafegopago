import { NextRequest, NextResponse } from "next/server";
import { getShareLinkByToken, isShareLinkValid } from "@/lib/evolution-share-links";
import { getEvolutionSessionById } from "@/lib/evolution-sessions";

export const dynamic = "force-dynamic";

/**
 * GET /api/conectar-evolution/[token] — valida o token do link compartilhável
 * de conexão WhatsApp via Evolution. Rota pública (sem getSession()) — não
 * expõe a API key da instância nunca.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const link = getShareLinkByToken(token);

  if (!link) {
    return NextResponse.json({ valid: false, error: "Link não encontrado." }, { status: 404 });
  }
  if (link.usedAt) {
    return NextResponse.json({ valid: false, error: "Este link já foi usado para conectar. Peça um link novo." }, { status: 410 });
  }
  if (link.revoked) {
    return NextResponse.json({ valid: false, error: "Este link não é mais válido. Peça um link novo." }, { status: 410 });
  }
  if (!isShareLinkValid(link)) {
    return NextResponse.json({ valid: false, error: "Link inválido." }, { status: 410 });
  }

  const evoSession = getEvolutionSessionById(link.evolutionSessionId);
  if (!evoSession) {
    return NextResponse.json({ valid: false, error: "Sessão não encontrada." }, { status: 404 });
  }

  return NextResponse.json({ valid: true, instanceName: evoSession.instanceName, evolutionSessionId: evoSession.id });
}
