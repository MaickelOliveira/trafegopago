import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getClientById, upsertClient } from "@/lib/clients";
import type { AgentConfig } from "@/lib/clients";

// GET /api/agent?clientId=xxx — retorna config do agente
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "manager") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const clientId = req.nextUrl.searchParams.get("clientId");
  if (!clientId) return NextResponse.json({ error: "clientId required" }, { status: 400 });

  const client = getClientById(clientId);
  if (!client) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const cfg = client.agentConfig ?? {
    enabled: false,
    followUpEnabled: false,
    followUps: [],
  };

  // Não expõe tokens sensíveis — retorna booleano se conectado
  return NextResponse.json({
    ...cfg,
    googleRefreshToken: undefined,
    calendarConnected: !!cfg.googleRefreshToken,
  });
}

// PUT /api/agent?clientId=xxx — salva config do agente
export async function PUT(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "manager") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const clientId = req.nextUrl.searchParams.get("clientId");
  if (!clientId) return NextResponse.json({ error: "clientId required" }, { status: 400 });

  const client = getClientById(clientId);
  if (!client) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await req.json().catch(() => ({})) as Partial<AgentConfig>;

  const current = client.agentConfig ?? { enabled: false, followUpEnabled: false, followUps: [] };

  // Preserva googleRefreshToken existente se não foi alterado
  const updated: AgentConfig = {
    ...current,
    ...body,
    googleRefreshToken: body.googleRefreshToken ?? current.googleRefreshToken,
  };

  upsertClient({ ...client, agentConfig: updated });
  return NextResponse.json({ ok: true });
}

// PATCH /api/agent?clientId=xxx — toggle enabled / followUpEnabled
export async function PATCH(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "manager") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const clientId = req.nextUrl.searchParams.get("clientId");
  if (!clientId) return NextResponse.json({ error: "clientId required" }, { status: 400 });

  const client = getClientById(clientId);
  if (!client) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await req.json().catch(() => ({})) as { field: "enabled" | "followUpEnabled"; value: boolean };
  const current = client.agentConfig ?? { enabled: false, followUpEnabled: false, followUps: [] };
  const updated = { ...current, [body.field]: body.value };

  upsertClient({ ...client, agentConfig: updated });
  return NextResponse.json({ ok: true, [body.field]: body.value });
}
