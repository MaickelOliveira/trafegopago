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

  const body = await req.json() as { force?: boolean; webhookUrl?: string; previousQr?: string | null };

  // Sempre faz logout antes de reiniciar a sessão: o servidor WPPConnect mantém o QR
  // em cache e não o renova sozinho — sem o logout, start-session é um no-op e
  // qrcode-session continua devolvendo o mesmo QR (já expirado).
  // close-session (dentro de logoutSession) fecha o navegador, mas o Puppeteer leva
  // alguns segundos pra liberar o lock do userDataDir — se start-session rodar antes
  // disso, ele falha silenciosamente e o QR antigo (já expirado) continua sendo
  // devolvido. 5s não bastava na maioria das vezes; usa 15s.
  await logoutSession(wppSession.sessionName, wppSession.sessionToken).catch(() => {});
  await new Promise(r => setTimeout(r, 15000));

  if (body.webhookUrl) {
    await startSession(wppSession.sessionName, wppSession.sessionToken, body.webhookUrl).catch(() => {});
    await new Promise(r => setTimeout(r, 3000));
  }

  // qrcode-session pode continuar devolvendo o QR antigo (já expirado) por um tempo
  // após o restart — só considera "pronto" quando vier um QR DIFERENTE do anterior.
  // Se não conseguir dentro do tempo, devolve null: o frontend tenta de novo no
  // próximo ciclo de polling.
  let qr: string | null = null;
  for (let i = 0; i < 10; i++) {
    qr = await getQrCode(wppSession.sessionName, wppSession.sessionToken);
    if (qr && qr !== body.previousQr) break;
    qr = null;
    await new Promise(r => setTimeout(r, 2000));
  }

  return NextResponse.json({ status: "connecting", qr });
}
