import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getQrCode, logoutSession, shouldRestartWppSession, startSession } from "@/lib/wppconnect-api";
import { getWppSessionById } from "@/lib/wppconnect-sessions";

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

  const body = await req.json() as { force?: boolean; webhookUrl?: string; previousQr?: string | null };
  const { sessionName, sessionToken } = wppSession;

  // "Trocar número" (force=true): a sessão está autenticada com outro número —
  // logout-session só tem efeito em sessões autenticadas, então só faz sentido aqui.
  // Em sessões ainda na tela de QR ele só gera erro no servidor sem efeito nenhum.
  if (body.force) {
    await logoutSession(sessionName, sessionToken).catch(() => {});
  }

  const restarted = !!body.webhookUrl && shouldRestartWppSession(sessionName, body.force);

  if (restarted) {
    await startSession(sessionName, sessionToken, body.webhookUrl as string).catch(() => {});
  }

  if (!restarted) {
    const qr = await getQrCode(sessionName, sessionToken);
    return NextResponse.json({ status: "connecting", qr: qr && qr !== body.previousQr ? qr : null });
  }

  // Acabou de reiniciar: o catchQR roda assíncrono após o start-session, então
  // espera o novo QR aparecer. Se não vier um QR diferente do anterior dentro do
  // tempo, devolve null — o frontend tenta de novo no próximo ciclo de polling.
  let qr: string | null = null;
  for (let i = 0; i < 10; i++) {
    qr = await getQrCode(sessionName, sessionToken);
    if (qr && qr !== body.previousQr) break;
    qr = null;
    await new Promise(r => setTimeout(r, 2000));
  }

  return NextResponse.json({ status: "connecting", qr });
}
