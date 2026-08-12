import { NextRequest, NextResponse } from "next/server";
import { claimPairingCode } from "@/lib/extension-pairing-codes";
import { createDevice } from "@/lib/extension-devices";
import { recordAuditEvent, truncateIp } from "@/lib/extension-audit-log";
import { checkRateLimit } from "@/lib/rate-limit";
import { EXTENSION_CONSENT_VERSION } from "@/lib/extension-types";

function clientIp(req: NextRequest): string | undefined {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || undefined;
}

/** Chamada pela extensão — NÃO tem acesso ao cookie httpOnly da plataforma
 *  (domínios diferentes), então o código temporário É a credencial dessa
 *  chamada. Nunca aceitar sessão de cookie aqui por engano. */
export async function POST(req: NextRequest) {
  const ip = clientIp(req);

  // Proteção contra força bruta de adivinhar um código válido — por IP, não
  // por código (um código errado não é atribuível a nenhum registro).
  if (!checkRateLimit(`claim:${ip ?? "unknown"}`, 8, 10 * 60 * 1000)) {
    return NextResponse.json({ error: "Muitas tentativas. Aguarde alguns minutos." }, { status: 429 });
  }

  const body = await req.json().catch(() => null) as { code?: string; devicePublicId?: string; consentVersion?: string } | null;
  if (!body?.code || !body.devicePublicId) {
    return NextResponse.json({ error: "code e devicePublicId são obrigatórios" }, { status: 400 });
  }
  if (body.consentVersion !== EXTENSION_CONSENT_VERSION) {
    return NextResponse.json({ error: "Consentimento desatualizado — atualize a extensão." }, { status: 400 });
  }

  const result = claimPairingCode(body.code);
  if (!result.ok) {
    recordAuditEvent({ event: "claim_failed", ip: truncateIp(ip) });
    const messages: Record<typeof result.reason, string> = {
      not_found: "Código inválido.",
      expired: "Código expirado.",
      used: "Código já utilizado.",
    };
    return NextResponse.json({ error: messages[result.reason], reason: result.reason }, { status: 400 });
  }

  const { device, token } = createDevice({
    clientId: result.pairing.clientId,
    employeeId: result.pairing.employeeId,
    funnelId: result.pairing.funnelId,
    devicePublicId: body.devicePublicId,
    consentVersion: body.consentVersion,
  });

  recordAuditEvent({
    event: "claim_succeeded",
    clientId: result.pairing.clientId,
    pairingId: result.pairing.id,
    deviceId: device.id,
    ip: truncateIp(ip),
  });

  return NextResponse.json({
    deviceId: device.id,
    deviceToken: token,
    clientId: device.clientId,
  });
}
