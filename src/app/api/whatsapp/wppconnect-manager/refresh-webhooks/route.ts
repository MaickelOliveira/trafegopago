import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getWppSessions } from "@/lib/wppconnect-sessions";
import { checkConnectionStatus, startSession } from "@/lib/wppconnect-api";

function detectBase(req: NextRequest): string {
  const fwdHost  = req.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const fwdProto = req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() ?? "https";
  return fwdHost ? `${fwdProto}://${fwdHost}` : `${req.nextUrl.protocol}//${req.nextUrl.host}`;
}

/**
 * Re-registra o webhook no WPPConnect apenas para sessões CONECTADAS.
 * Sessões desconectadas/em QR são ignoradas para não interromper o fluxo de conexão.
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "manager") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const baseUrl = detectBase(req);
  const sessions = getWppSessions();

  const results: { sessionName: string; webhookUrl: string; ok: boolean; skipped?: boolean }[] = [];

  for (const wpp of sessions) {
    const webhookUrl = `${baseUrl}/api/whatsapp/webhook/wppconnect/${wpp.id}`;
    try {
      // Só registra webhook para sessões já conectadas — não interrompe sessões em QR
      const status = await checkConnectionStatus(wpp.sessionName, wpp.sessionToken);
      if (status !== "CONNECTED") {
        results.push({ sessionName: wpp.sessionName, webhookUrl, ok: true, skipped: true });
        console.log(`[refresh-webhooks] Skipped ${wpp.sessionName} (status=${status})`);
        continue;
      }
      await startSession(wpp.sessionName, wpp.sessionToken, webhookUrl);
      results.push({ sessionName: wpp.sessionName, webhookUrl, ok: true });
      console.log(`[refresh-webhooks] Registered ${wpp.sessionName} → ${webhookUrl}`);
    } catch {
      results.push({ sessionName: wpp.sessionName, webhookUrl, ok: false });
    }
  }

  return NextResponse.json({ results, baseUrl });
}
