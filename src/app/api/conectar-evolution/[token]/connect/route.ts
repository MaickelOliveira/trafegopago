import { NextRequest, NextResponse } from "next/server";
import { getShareLinkByToken, isShareLinkValid } from "@/lib/evolution-share-links";
import {
  checkConnectionStatus,
  getQrCode,
  getEvolutionRestartCooldownRemainingMs,
  logoutInstance,
  shouldRestartEvolutionSession,
  createOrRestartInstance,
} from "@/lib/evolution-api";
import { getEvolutionSessionById, updateEvolutionSession } from "@/lib/evolution-sessions";

export const dynamic = "force-dynamic";

/**
 * POST /api/conectar-evolution/[token]/connect — equivalente público de
 * /api/whatsapp/evolution-manager/[sessionId]/connect, validado por token de
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

  const evoSession = getEvolutionSessionById(link.evolutionSessionId);
  if (!evoSession) return NextResponse.json({ error: "Sessão não encontrada" }, { status: 404 });

  const body = await req.json() as { force?: boolean; webhookUrl?: string; previousQr?: string | null };
  const { instanceName } = evoSession;

  const currentStatus = await checkConnectionStatus(instanceName);
  // Trava de segurança: nunca reinicia (nem com force=true) uma instância que
  // já está CONECTADA de verdade — evita derrubar uma conexão ativa caso o
  // botão "tentar de novo" seja clicado bem no instante em que acabou de
  // conectar, antes da tela perceber que já deu certo.
  if (currentStatus === "CONNECTED") {
    return NextResponse.json({ status: "connected", qr: null, cooldownMs: 0 });
  }
  const isIdle = currentStatus === "DISCONNECTED" || currentStatus === "UNKNOWN";
  if (body.force || isIdle) {
    await logoutInstance(instanceName).catch(() => {});
  }

  const wantsRestart = body.force || isIdle;
  const restarted = !!body.webhookUrl && wantsRestart && shouldRestartEvolutionSession(instanceName, body.force);
  const cooldownMs = !restarted && wantsRestart ? getEvolutionRestartCooldownRemainingMs(instanceName) : 0;

  if (restarted) {
    const result = await createOrRestartInstance(instanceName, body.webhookUrl as string).catch(() => null);
    if (result?.apiKey) updateEvolutionSession(link.evolutionSessionId, { instanceApiKey: result.apiKey });
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
