import { NextRequest, NextResponse } from "next/server";
import { getShareLinkByToken, isShareLinkValid } from "@/lib/wpp-share-links";
import { checkConnectionStatus, getQrCode, getRestartCooldownRemainingMs, logoutSession, shouldRestartWppSession, startSession } from "@/lib/wppconnect-api";
import { getWppSessionById } from "@/lib/wppconnect-sessions";

export const dynamic = "force-dynamic";

/**
 * POST /api/conectar/[token]/connect — equivalente público de
 * /api/whatsapp/wppconnect-manager/[sessionId]/connect, validado por token de
 * link compartilhável em vez de sessão de gestor logado. Mesma lógica interna.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const link = getShareLinkByToken(token);
  if (!isShareLinkValid(link)) {
    return NextResponse.json({ error: "Link inválido ou já utilizado." }, { status: 410 });
  }

  const wppSession = getWppSessionById(link.wppSessionId);
  if (!wppSession) return NextResponse.json({ error: "Sessão não encontrada" }, { status: 404 });

  const body = await req.json() as { force?: boolean; webhookUrl?: string; previousQr?: string | null };
  const { sessionName, sessionToken } = wppSession;

  const currentStatus = await checkConnectionStatus(sessionName, sessionToken);
  const isIdle = currentStatus === "DISCONNECTED" || currentStatus === "UNKNOWN";
  if (body.force || isIdle) {
    await logoutSession(sessionName, sessionToken).catch(() => {});
  }

  const wantsRestart = body.force || isIdle;
  const restarted = !!body.webhookUrl && wantsRestart && shouldRestartWppSession(sessionName, body.force);
  const cooldownMs = !restarted && wantsRestart ? getRestartCooldownRemainingMs(sessionName) : 0;

  if (restarted) {
    await startSession(sessionName, sessionToken, body.webhookUrl as string).catch(() => {});
  }

  if (!restarted) {
    const qr = await getQrCode(sessionName, sessionToken);
    return NextResponse.json({ status: "connecting", qr: qr && qr !== body.previousQr ? qr : null, cooldownMs });
  }

  let qr: string | null = null;
  for (let i = 0; i < 10; i++) {
    qr = await getQrCode(sessionName, sessionToken);
    if (qr && qr !== body.previousQr) break;
    qr = null;
    await new Promise(r => setTimeout(r, 2000));
  }

  return NextResponse.json({ status: "connecting", qr, cooldownMs: 0 });
}
