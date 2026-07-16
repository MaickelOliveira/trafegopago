import { NextRequest, NextResponse } from "next/server";
import { getShareLinkByToken, isShareLinkValid, markShareLinkUsed } from "@/lib/evolution-share-links";
import { checkConnectionStatus, getQrCode } from "@/lib/evolution-api";
import { getEvolutionSessionById } from "@/lib/evolution-sessions";

export const dynamic = "force-dynamic";

/**
 * GET /api/conectar-evolution/[token]/status — equivalente público de
 * /api/whatsapp/evolution-manager/[sessionId]/status. Quando a conexão é
 * concluída, marca o link como usado — a partir daí ele para de funcionar.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const link = getShareLinkByToken(token);
  if (!isShareLinkValid(link)) {
    return NextResponse.json({ error: "Link inválido ou já utilizado." }, { status: 410 });
  }

  const evoSession = getEvolutionSessionById(link.evolutionSessionId);
  if (!evoSession) return NextResponse.json({ error: "Não encontrado" }, { status: 404 });

  const rawStatus = await checkConnectionStatus(evoSession.instanceName);
  const connected = rawStatus === "CONNECTED";

  let qr: string | null = null;
  if (!connected) {
    for (let i = 0; i < 3; i++) {
      qr = await getQrCode(evoSession.instanceName).catch(() => null);
      if (qr) break;
      if (i < 2) await new Promise(r => setTimeout(r, 1000));
    }
  } else {
    markShareLinkUsed(token);
  }

  return NextResponse.json({
    status: connected ? "connected" : rawStatus.toLowerCase(),
    connected,
    qr,
  });
}
