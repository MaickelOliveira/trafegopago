import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { checkConnectionStatus, getQrCode } from "@/lib/wppconnect-api";
import { getWppSessionById } from "@/lib/wppconnect-sessions";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { sessionId } = await params;
  const wppSession = getWppSessionById(sessionId);
  if (!wppSession) return NextResponse.json({ error: "Não encontrado" }, { status: 404 });

  const rawStatus = await checkConnectionStatus(wppSession.sessionName, wppSession.sessionToken);
  const connected = rawStatus === "CONNECTED";

  // Tenta obter QR sempre que não estiver conectado (WPPConnect retorna PNG se disponível)
  let qr: string | null = null;
  if (!connected) {
    qr = await getQrCode(wppSession.sessionName, wppSession.sessionToken).catch(() => null);
  }

  return NextResponse.json({
    status: connected ? "connected" : rawStatus.toLowerCase(),
    connected,
    phone: null,
    name: null,
    qr,
  });
}
