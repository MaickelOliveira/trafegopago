import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getEvolutionSessions } from "@/lib/evolution-sessions";
import { checkConnectionStatus, setWebhook } from "@/lib/evolution-api";

function detectBase(req: NextRequest): string {
  const fwdHost  = req.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const fwdProto = req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() ?? "https";
  return fwdHost ? `${fwdProto}://${fwdHost}` : `${req.nextUrl.protocol}//${req.nextUrl.host}`;
}

/**
 * Re-registra o webhook na Evolution apenas para instâncias CONECTADAS.
 * Instâncias desconectadas/em QR são ignoradas para não interromper o fluxo de conexão.
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "manager") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const baseUrl = detectBase(req);
  const sessions = getEvolutionSessions();

  const results: { instanceName: string; webhookUrl: string; ok: boolean; skipped?: boolean }[] = [];

  for (const evo of sessions) {
    const webhookUrl = `${baseUrl}/api/whatsapp/webhook/evolution/${evo.id}`;
    try {
      const status = await checkConnectionStatus(evo.instanceName);
      if (status !== "CONNECTED") {
        results.push({ instanceName: evo.instanceName, webhookUrl, ok: true, skipped: true });
        console.log(`[evolution refresh-webhooks] Skipped ${evo.instanceName} (status=${status})`);
        continue;
      }
      const ok = await setWebhook(evo.instanceName, evo.instanceApiKey, webhookUrl);
      results.push({ instanceName: evo.instanceName, webhookUrl, ok });
      console.log(`[evolution refresh-webhooks] Registered ${evo.instanceName} → ${webhookUrl}`);
    } catch {
      results.push({ instanceName: evo.instanceName, webhookUrl, ok: false });
    }
  }

  return NextResponse.json({ results, baseUrl });
}
