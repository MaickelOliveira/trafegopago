import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getQrCode, logoutSession, startSession } from "@/lib/wppconnect-api";
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

  const body = await req.json() as { force?: boolean; webhookUrl?: string };

  if (body.force) {
    await logoutSession(wppSession.sessionName, wppSession.sessionToken).catch(() => {});
    await new Promise(r => setTimeout(r, 2000));
  }

  // Reinicia sessão para gerar QR
  if (body.webhookUrl) {
    await startSession(wppSession.sessionName, wppSession.sessionToken, body.webhookUrl).catch(() => {});
    await new Promise(r => setTimeout(r, 3000));
  }

  // Tenta obter QR com até 8 tentativas (WPPConnect pode demorar até ~16s para gerar)
  let qr: string | null = null;
  for (let i = 0; i < 8; i++) {
    qr = await getQrCode(wppSession.sessionName, wppSession.sessionToken);
    if (qr) break;
    await new Promise(r => setTimeout(r, 2000));
  }

  return NextResponse.json({ status: "connecting", qr });
}
