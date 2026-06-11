import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";
import { getWppSessions, getWppSessionById } from "@/lib/wppconnect-sessions";
import { checkConnectionStatus, listSessions, getQrCode, startSession, logoutSession } from "@/lib/wppconnect-api";

export const dynamic = "force-dynamic";

function detectBase(req: NextRequest): string {
  const fwdHost  = req.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const fwdProto = req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() ?? "https";
  return fwdHost ? `${fwdProto}://${fwdHost}` : `${req.nextUrl.protocol}//${req.nextUrl.host}`;
}

/** Debug: lista sessões WPPConnect locais (sem token) + status ao vivo + sessões no servidor WPPConnect. */
export async function GET(req: NextRequest) {
  // ?probe=<sessionId> — replica o fluxo do botão "Conectar": chama start-session
  // e busca o QR, retornando um hash p/ comparar se sessões diferentes geram QRs iguais.
  const probeId = req.nextUrl.searchParams.get("probe");
  // ?force=1 — faz logout-session antes do start-session, p/ testar se a sessão
  // está "travada" no servidor WPPConnect com um QR expirado em cache.
  const force = req.nextUrl.searchParams.get("force") === "1";
  if (probeId) {
    const s = getWppSessionById(probeId);
    if (!s) return NextResponse.json({ error: "Sessão não encontrada" }, { status: 404 });

    const baseUrl = detectBase(req);
    const webhookUrl = `${baseUrl}/api/whatsapp/webhook/wppconnect/${s.id}`;
    const statusBefore = await checkConnectionStatus(s.sessionName, s.sessionToken).catch(() => "ERROR");
    if (force) {
      await logoutSession(s.sessionName, s.sessionToken).catch(() => {});
      await new Promise((r) => setTimeout(r, 2000));
    }
    await startSession(s.sessionName, s.sessionToken, webhookUrl).catch(() => {});
    await new Promise((r) => setTimeout(r, 3000));

    let qr: string | null = null;
    for (let i = 0; i < 5; i++) {
      qr = await getQrCode(s.sessionName, s.sessionToken);
      if (qr) break;
      await new Promise((r) => setTimeout(r, 2000));
    }

    const statusAfter = await checkConnectionStatus(s.sessionName, s.sessionToken).catch(() => "ERROR");
    const qrHash = qr ? createHash("sha256").update(qr).digest("hex").slice(0, 16) : null;
    return NextResponse.json({ id: s.id, sessionName: s.sessionName, statusBefore, statusAfter, forced: force, qrLength: qr?.length ?? 0, qrHash });
  }

  const local = getWppSessions();

  const sessions = await Promise.all(
    local.map(async (s) => ({
      id: s.id,
      sessionName: s.sessionName,
      funnelId: s.funnelId,
      clientId: s.clientId,
      status: await checkConnectionStatus(s.sessionName, s.sessionToken).catch(() => "ERROR"),
    }))
  );

  const nameCount = new Map<string, number>();
  for (const s of local) nameCount.set(s.sessionName, (nameCount.get(s.sessionName) ?? 0) + 1);
  const duplicateSessionNames = [...nameCount.entries()].filter(([, n]) => n > 1).map(([name]) => name);

  const serverSessions = await listSessions().catch(() => []);

  return NextResponse.json({
    totalLocal: local.length,
    duplicateSessionNames,
    sessions,
    serverSessions,
  });
}
