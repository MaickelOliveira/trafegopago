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
  if (!session || (session.role !== "client" && session.role !== "employee" && session.role !== "manager")) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  // Gestor gera o código EM NOME de um cliente específico (ex: pra ajudar
  // alguém menos técnico a conectar) — mesmo acesso irrestrito a qualquer
  // organização que ele já tem no resto do painel administrativo (ver
  // revoke/route.ts). Cliente/funcionário continuam usando a própria sessão.
  let targetClientId: string;
  if (session.role === "manager") {
    const body = await req.json().catch(() => null) as { clientId?: string } | null;
    if (!body?.clientId) return NextResponse.json({ error: "clientId obrigatório" }, { status: 400 });
    targetClientId = body.clientId;
  } else {
    if (!session.clientId) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    if (session.role === "employee") {
      const { getEmployeeById } = await import("@/lib/employees");
      const emp = session.employeeId ? getEmployeeById(session.employeeId) : null;
      if (!emp || !emp.active || !emp.permissions?.canManageQR) {
        return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
      }
    }
    targetClientId = session.clientId;
  }

  const ip = clientIp(req);
  // Limita geração de código a 10 por 10 min por usuário — evita spam de
  // criação (cada código novo já invalida o anterior, então isso é só
  // proteção contra abuso automatizado, não um fluxo normal de uso).
  if (!checkRateLimit(`pairing-code:${session.sub}`, 10, 10 * 60 * 1000)) {
    return NextResponse.json({ error: "Muitas tentativas. Aguarde alguns minutos." }, { status: 429 });
  }

  const { code, expiresAt } = createPairingCode(targetClientId, {
    employeeId: session.role === "employee" ? session.employeeId : undefined,
    createdIp: ip,
  });

  recordAuditEvent({
    event: "pairing_code_created",
    clientId: targetClientId,
    ip: truncateIp(ip),
  });

  return NextResponse.json({ code, expiresAt });
}
