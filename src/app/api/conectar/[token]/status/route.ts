import { NextRequest, NextResponse } from "next/server";
import { getShareLinkByToken, isShareLinkValid, markShareLinkUsed } from "@/lib/wpp-share-links";
import { checkConnectionStatus, getQrCode } from "@/lib/wppconnect-api";
import { getWppSessionById } from "@/lib/wppconnect-sessions";

export const dynamic = "force-dynamic";

/**
 * GET /api/conectar/[token]/status — equivalente público de
 * /api/whatsapp/wppconnect-manager/[sessionId]/status. Quando a conexão é
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

  const wppSession = getWppSessionById(link.wppSessionId);
  if (!wppSession) return NextResponse.json({ error: "Não encontrado" }, { status: 404 });

  const rawStatus = await checkConnectionStatus(wppSession.sessionName, wppSession.sessionToken);
  const connected = rawStatus === "CONNECTED";

  let qr: string | null = null;
  if (!connected) {
    for (let i = 0; i < 3; i++) {
      qr = await getQrCode(wppSession.sessionName, wppSession.sessionToken).catch(() => null);
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
