import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getClients, upsertClient } from "@/lib/clients";
import { getFunnels, updateFunnel } from "@/lib/funnels";
import { deleteInstance } from "@/lib/uazapi";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const session = await getSession();
  if (!session || session.role !== "manager") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { token } = await params;

  // 1. Delete from UazAPI (best-effort)
  await deleteInstance(token).catch(() => {});

  // 2. Remove from all funnels where conn.uazapiToken === token
  const funnels = getFunnels();
  let removedConnId: string | null = null;
  for (const funnel of funnels) {
    const conn = funnel.connections?.find(c => c.type === "uazapi" && c.uazapiToken === token);
    if (conn) {
      removedConnId = conn.id;
      const newConnections = (funnel.connections ?? []).filter(c => c.uazapiToken !== token);
      updateFunnel(funnel.id, { connections: newConnections });
    }
  }

  // 3. Clear agentConfig.whatsappConnectionId for any client using this connection
  if (removedConnId) {
    const clients = getClients();
    for (const client of clients) {
      if (client.agentConfig?.whatsappConnectionId === removedConnId) {
        upsertClient({
          ...client,
          agentConfig: { ...client.agentConfig, whatsappConnectionId: undefined },
        });
      }
    }
  }

  return NextResponse.json({ ok: true });
}
