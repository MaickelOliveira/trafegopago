import { NextRequest, NextResponse } from "next/server";
import { getSession, type JWTPayload } from "@/lib/auth";
import { getClientById } from "@/lib/clients";
import { createFunnel, getFunnels, updateFunnel } from "@/lib/funnels";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  createServerWhatsAppSession,
  deleteServerWhatsAppSession,
  getServerWhatsAppSessionById,
  getServerWhatsAppSessions,
  updateServerWhatsAppSession,
} from "@/lib/server-whatsapp-sessions";
import {
  disconnectServerWhatsApp,
  getServerWhatsAppStatus,
  requestServerWhatsAppPairingCode,
} from "@/lib/server-whatsapp-api";

export const dynamic = "force-dynamic";

async function resolveClientId(
  session: JWTPayload,
  requestedClientId?: string | null,
): Promise<{ clientId: string } | { error: NextResponse }> {
  if (session.role === "manager") {
    if (!requestedClientId || !getClientById(requestedClientId)) {
      return { error: NextResponse.json({ error: "Cliente não encontrado" }, { status: 404 }) };
    }
    return { clientId: requestedClientId };
  }

  if (!session.clientId) {
    return { error: NextResponse.json({ error: "Não autorizado" }, { status: 401 }) };
  }

  if (session.role === "employee") {
    const { getEmployeeById } = await import("@/lib/employees");
    const employee = session.employeeId ? getEmployeeById(session.employeeId) : null;
    if (!employee?.active || !employee.permissions?.canManageQR) {
      return { error: NextResponse.json({ error: "Sem permissão" }, { status: 403 }) };
    }
  }

  return { clientId: session.clientId };
}

function normalizePhone(value: unknown): string | null {
  let digits = String(value ?? "").replace(/\D/g, "");
  if (digits.length === 10 || digits.length === 11) digits = `55${digits}`;
  return digits.length >= 12 && digits.length <= 15 ? digits : null;
}

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const resolved = await resolveClientId(session, req.nextUrl.searchParams.get("clientId"));
  if ("error" in resolved) return resolved.error;

  const funnels = getFunnels().filter((funnel) => funnel.clientId === resolved.clientId);
  const funnelNames = new Map(funnels.map((funnel) => [funnel.id, funnel.name]));
  const sessions = getServerWhatsAppSessions().filter((item) => item.clientId === resolved.clientId);

  const connections = await Promise.all(sessions.map(async (item) => {
    try {
      const live = await getServerWhatsAppStatus(item.id);
      if ((live.phone && live.phone !== item.phone) || (live.name && live.name !== item.name)) {
        updateServerWhatsAppSession(item.id, {
          phone: live.phone ?? item.phone,
          name: live.name ?? item.name,
        });
      }
      return {
        ...item,
        phone: live.phone ?? item.phone,
        name: live.name ?? item.name,
        funnelName: funnelNames.get(item.funnelId) ?? "Funil Principal",
        status: live.status,
      };
    } catch {
      return {
        ...item,
        funnelName: funnelNames.get(item.funnelId) ?? "Funil Principal",
        status: "disconnected" as const,
      };
    }
  }));

  return NextResponse.json({ connections });
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const body = await req.json().catch(() => null) as { phone?: string; clientId?: string } | null;
  const resolved = await resolveClientId(session, body?.clientId);
  if ("error" in resolved) return resolved.error;

  const phone = normalizePhone(body?.phone);
  if (!phone) {
    return NextResponse.json(
      { error: "Informe o telefone com DDD e DDI. Exemplo: 5511999999999" },
      { status: 400 },
    );
  }

  if (!checkRateLimit(`server-wa-pairing:${session.sub}`, 6, 10 * 60 * 1000)) {
    return NextResponse.json({ error: "Muitas tentativas. Aguarde alguns minutos." }, { status: 429 });
  }

  let funnels = getFunnels().filter((funnel) => funnel.clientId === resolved.clientId);
  if (funnels.length === 0) {
    const created = createFunnel("Funil Principal");
    const linked = updateFunnel(created.id, { clientId: resolved.clientId });
    funnels = linked ? [linked] : [];
  }
  const funnel = funnels[0];
  if (!funnel) {
    return NextResponse.json({ error: "Não foi possível criar o funil do cliente" }, { status: 500 });
  }

  let stored = getServerWhatsAppSessions().find((item) => item.clientId === resolved.clientId);
  if (!stored) {
    stored = createServerWhatsAppSession({
      clientId: resolved.clientId,
      funnelId: funnel.id,
      phone,
    });
  } else {
    stored = updateServerWhatsAppSession(stored.id, { phone, funnelId: funnel.id }) ?? stored;
  }

  try {
    const current = await getServerWhatsAppStatus(stored.id).catch(() => null);
    if (current?.status === "connected") {
      return NextResponse.json({
        connectionId: stored.id,
        status: "connected",
        phone: current.phone ?? stored.phone,
        alreadyConnected: true,
      });
    }

    const result = await requestServerWhatsAppPairingCode({
      connectionId: stored.id,
      clientId: stored.clientId,
      funnelId: stored.funnelId,
      phone,
    });

    return NextResponse.json({
      connectionId: stored.id,
      code: result.code,
      status: result.status,
      phone,
    });
  } catch (error) {
    console.error("[whatsapp-server] Falha ao gerar código:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao gerar código no servidor" },
      { status: 502 },
    );
  }
}

export async function DELETE(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const body = await req.json().catch(() => null) as { connectionId?: string; clientId?: string } | null;
  const resolved = await resolveClientId(session, body?.clientId);
  if ("error" in resolved) return resolved.error;

  const stored = body?.connectionId ? getServerWhatsAppSessionById(body.connectionId) : undefined;
  if (!stored || stored.clientId !== resolved.clientId) {
    return NextResponse.json({ error: "Conexão não encontrada" }, { status: 404 });
  }

  await disconnectServerWhatsApp(stored.id).catch((error) => {
    console.error(`[whatsapp-server] Falha ao remover sessão ativa ${stored.id}:`, error);
  });
  deleteServerWhatsAppSession(stored.id);
  return NextResponse.json({ ok: true });
}

