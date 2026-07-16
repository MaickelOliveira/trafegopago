import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import {
  checkConnectionStatus,
  getQrCode,
  getEvolutionRestartCooldownRemainingMs,
  logoutInstance,
  shouldRestartEvolutionSession,
  createOrRestartInstance,
} from "@/lib/evolution-api";
import { getEvolutionSessionById, updateEvolutionSession } from "@/lib/evolution-sessions";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const session = await getSession();
  if (!session || session.role !== "manager") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { sessionId } = await params;
  const evoSession = getEvolutionSessionById(sessionId);
  if (!evoSession) return NextResponse.json({ error: "Sessão não encontrada" }, { status: 404 });

  const body = await req.json() as { force?: boolean; webhookUrl?: string; previousQr?: string | null };
  const { instanceName } = evoSession;

  // Mesmo cuidado do WPPConnect: só reinicia quando a instância está parada/
  // zumbi (DISCONNECTED/UNKNOWN) ou em "Trocar número" explícito — evita
  // derrubar uma conexão que acabou de dar certo bem na hora do polling.
  const currentStatus = await checkConnectionStatus(instanceName);
  const isIdle = currentStatus === "DISCONNECTED" || currentStatus === "UNKNOWN";
  if (body.force || isIdle) {
    await logoutInstance(instanceName).catch(() => {});
  }

  const wantsRestart = body.force || isIdle;
  const restarted = !!body.webhookUrl && wantsRestart && shouldRestartEvolutionSession(instanceName, body.force);
  const cooldownMs = !restarted && wantsRestart ? getEvolutionRestartCooldownRemainingMs(instanceName) : 0;

  if (restarted) {
    const result = await createOrRestartInstance(instanceName, body.webhookUrl as string).catch(() => null);
    if (result?.apiKey) updateEvolutionSession(sessionId, { instanceApiKey: result.apiKey });
    // A Evolution devolve o QR direto na resposta do create/restart — só cai no
    // polling abaixo se por algum motivo ele não vier junto.
    if (result?.qrBase64 && result.qrBase64 !== body.previousQr) {
      return NextResponse.json({ status: "connecting", qr: result.qrBase64, cooldownMs: 0 });
    }
  }

  if (!restarted) {
    const qr = await getQrCode(instanceName);
    return NextResponse.json({ status: "connecting", qr: qr && qr !== body.previousQr ? qr : null, cooldownMs });
  }

  let qr: string | null = null;
  for (let i = 0; i < 10; i++) {
    qr = await getQrCode(instanceName);
    if (qr && qr !== body.previousQr) break;
    qr = null;
    await new Promise(r => setTimeout(r, 2000));
  }

  return NextResponse.json({ status: "connecting", qr, cooldownMs: 0 });
}
