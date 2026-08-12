import { NextRequest, NextResponse } from "next/server";
import { getDeviceByToken, updateHeartbeat } from "@/lib/extension-devices";
import { recordAuditEvent } from "@/lib/extension-audit-log";
import { checkRateLimit } from "@/lib/rate-limit";
import type { ExtensionConnectorState } from "@/lib/extension-types";

const VALID_STATES: ExtensionConnectorState[] = ["connected", "waiting_qr", "disconnected"];

function deviceToken(req: NextRequest): string | null {
  const header = req.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return null;
  return header.slice("Bearer ".length).trim();
}

/** Chamada periodicamente pelo service worker da extensão (via chrome.alarms)
 *  — autentica pela credencial do dispositivo (Bearer), nunca por cookie. */
export async function POST(req: NextRequest) {
  const token = deviceToken(req);
  if (!token) return NextResponse.json({ error: "Token ausente" }, { status: 401 });

  if (!checkRateLimit(`heartbeat:${token.slice(0, 12)}`, 20, 60 * 1000)) {
    return NextResponse.json({ error: "Muitas requisições" }, { status: 429 });
  }

  const device = getDeviceByToken(token);
  if (!device || device.status === "revoked") {
    recordAuditEvent({ event: "heartbeat_rejected" });
    return NextResponse.json({ error: "Dispositivo não autorizado" }, { status: 401 });
  }

  const body = await req.json().catch(() => null) as { connectorState?: string } | null;
  const connectorState = body?.connectorState as ExtensionConnectorState | undefined;
  if (!connectorState || !VALID_STATES.includes(connectorState)) {
    return NextResponse.json({ error: "connectorState inválido" }, { status: 400 });
  }

  updateHeartbeat(device.id, connectorState);
  return NextResponse.json({ ok: true });
}
