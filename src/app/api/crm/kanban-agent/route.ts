import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getClientById, upsertClient } from "@/lib/clients";

// PATCH /api/crm/kanban-agent?clientId=xxx — liga ou desliga o agente Kanban
export async function PATCH(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "manager") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const clientId = req.nextUrl.searchParams.get("clientId");
  if (!clientId) return NextResponse.json({ error: "clientId obrigatório" }, { status: 400 });

  const client = getClientById(clientId);
  if (!client) return NextResponse.json({ error: "Cliente não encontrado" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const enabled: boolean = typeof body.enabled === "boolean" ? body.enabled : !client.kanbanAgentEnabled;

  upsertClient({ ...client, kanbanAgentEnabled: enabled });

  return NextResponse.json({ ok: true, kanbanAgentEnabled: enabled });
}
