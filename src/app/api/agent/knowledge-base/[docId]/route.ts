import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getClientById, upsertClient } from "@/lib/clients";

export const dynamic = "force-dynamic";

type Params = Promise<{ docId: string }>;

function getConfigForConn(client: NonNullable<ReturnType<typeof getClientById>>, connId: string | null) {
  if (connId && client.agentConfigs) {
    const found = client.agentConfigs.find((c) => c.whatsappConnectionId === connId);
    if (found) return found;
  }
  return client.agentConfig ?? { enabled: false, followUpEnabled: false, followUps: [] };
}

function upsertConfigForConn(
  client: NonNullable<ReturnType<typeof getClientById>>,
  connId: string | null,
  updated: ReturnType<typeof getConfigForConn>
) {
  if (connId) {
    const existing = client.agentConfigs ?? [];
    const idx = existing.findIndex((c) => c.whatsappConnectionId === connId);
    const newConfigs = [...existing];
    if (idx >= 0) newConfigs[idx] = updated;
    else newConfigs.push({ ...updated, whatsappConnectionId: connId });
    upsertClient({ ...client, agentConfigs: newConfigs });
  } else {
    upsertClient({ ...client, agentConfig: updated });
  }
}

// DELETE /api/agent/knowledge-base/[docId]?clientId=xxx[&connId=yyy]
export async function DELETE(req: NextRequest, { params }: { params: Params }) {
  const session = await getSession();
  if (!session || session.role !== "manager") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { docId } = await params;
  const clientId = req.nextUrl.searchParams.get("clientId");
  if (!clientId) return NextResponse.json({ error: "clientId required" }, { status: 400 });

  const client = getClientById(clientId);
  if (!client) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const connId = req.nextUrl.searchParams.get("connId");
  const cfg = getConfigForConn(client, connId);

  const updated = {
    ...cfg,
    knowledgeBase: (cfg.knowledgeBase ?? []).filter((d) => d.id !== docId),
  };
  upsertConfigForConn(client, connId, updated);

  return NextResponse.json({ ok: true });
}
