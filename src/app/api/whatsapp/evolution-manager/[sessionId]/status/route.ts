import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { checkConnectionStatus, getQrCode } from "@/lib/evolution-api";
import { getEvolutionSessionById } from "@/lib/evolution-sessions";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { sessionId } = await params;
  const evoSession = getEvolutionSessionById(sessionId);
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
  }

  return NextResponse.json({
    status: connected ? "connected" : rawStatus.toLowerCase(),
    connected,
    phone: null,
    name: null,
    qr,
  });
}
