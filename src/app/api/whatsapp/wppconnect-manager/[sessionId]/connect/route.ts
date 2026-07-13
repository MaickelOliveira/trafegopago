import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { checkConnectionStatus, getQrCode, getRestartCooldownRemainingMs, logoutSession, shouldRestartWppSession, startSession } from "@/lib/wppconnect-api";
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

  // Limpa a sessão (logout-session + close-session) antes de reconectar — mas só
  // quando ela está parada/zumbi (DISCONNECTED) ou em "Trocar número" explícito.
  // Sem isso, uma sessão que já esteve autenticada e desconectou (ex: logout no
  // celular) fica "zumbi": o WPPConnect tenta restaurar os tokens salvos em vez
  // de abrir uma tela de QR limpa, e trava só emitindo eventos de presença.
  //
  // IMPORTANTE: esta rota também é chamada de novo pelo polling do front quando o
  // QR demora a aparecer (retry após 65s) — se a sessão já tiver conectado (ou
  // estiver no meio do pareamento) bem nessa hora, um logout aqui DERRUBARIA uma
  // conexão que tinha acabado de dar certo. Por isso só limpa quando o status
  // atual é DISCONNECTED/UNKNOWN (parada de verdade) ou quando force=true.
  const currentStatus = await checkConnectionStatus(sessionName, sessionToken);
  const isIdle = currentStatus === "DISCONNECTED" || currentStatus === "UNKNOWN";
  if (body.force || isIdle) {
    await logoutSession(sessionName, sessionToken).catch(() => {});
  }

  // Mesmo cuidado pro restart em si: startSession() fecha o navegador por dentro
  // (closeSession) antes de reabrir — só faz sentido reiniciar quando a sessão
  // está parada/zumbi ou em troca explícita, nunca enquanto já está conectando
  // (PAIRING/OPENING) ou conectada.
  const wantsRestart = body.force || isIdle;
  const restarted = !!body.webhookUrl && wantsRestart && shouldRestartWppSession(sessionName, body.force);
  // Só é "throttle" (ciclo interno do WPPConnect ainda rodando, ~60s) quando a
  // gente QUERIA reiniciar e não conseguiu por causa do cooldown — informa pro
  // front mostrar contagem em vez de parecer travado sem motivo.
  const cooldownMs = !restarted && wantsRestart ? getRestartCooldownRemainingMs(sessionName) : 0;

  if (restarted) {
    await startSession(sessionName, sessionToken, body.webhookUrl as string).catch(() => {});
  }

  if (!restarted) {
    const qr = await getQrCode(sessionName, sessionToken);
    return NextResponse.json({ status: "connecting", qr: qr && qr !== body.previousQr ? qr : null, cooldownMs });
  }

  // Acabou de reiniciar: o catchQR roda assíncrono após o start-session, então
  // espera o novo QR aparecer. Se não vier um QR diferente do anterior dentro do
  // tempo, devolve null — o frontend tenta de novo no próximo ciclo de polling.
  // Até 40s (20x2s) — o WPPConnect precisa abrir um navegador de verdade por
  // trás, e 20s muitas vezes não bastava, exigindo várias tentativas manuais.
  let qr: string | null = null;
  for (let i = 0; i < 20; i++) {
    qr = await getQrCode(sessionName, sessionToken);
    if (qr && qr !== body.previousQr) break;
    qr = null;
    await new Promise(r => setTimeout(r, 2000));
  }

  return NextResponse.json({ status: "connecting", qr, cooldownMs: 0 });
}
