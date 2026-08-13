import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { createPairingCode } from "@/lib/extension-pairing-codes";
import { recordAuditEvent, truncateIp } from "@/lib/extension-audit-log";
import { checkRateLimit } from "@/lib/rate-limit";

function clientIp(req: NextRequest): string | undefined {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || undefined;
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || (session.role !== "client" && session.role !== "employee") || !session.clientId) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }
  if (session.role === "employee") {
    const { getEmployeeById } = await import("@/lib/employees");
    const emp = session.employeeId ? getEmployeeById(session.employeeId) : null;
    if (!emp || !emp.active || !emp.permissions?.canManageQR) {
      return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
    }
  }

  const ip = clientIp(req);
  // Limita geração de código a 10 por 10 min por usuário — evita spam de
  // criação (cada código novo já invalida o anterior, então isso é só
  // proteção contra abuso automatizado, não um fluxo normal de uso).
  if (!checkRateLimit(`pairing-code:${session.sub}`, 10, 10 * 60 * 1000)) {
    return NextResponse.json({ error: "Muitas tentativas. Aguarde alguns minutos." }, { status: 429 });
  }

  const { code, expiresAt } = createPairingCode(session.clientId, {
    employeeId: session.employeeId,
    createdIp: ip,
  });

  recordAuditEvent({
    event: "pairing_code_created",
    clientId: session.clientId,
    ip: truncateIp(ip),
  });

  return NextResponse.json({ code, expiresAt });
}
