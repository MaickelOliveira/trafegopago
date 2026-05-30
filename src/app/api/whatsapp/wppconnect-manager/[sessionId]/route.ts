import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { closeSession } from "@/lib/wppconnect-api";
import { getWppSessionById, deleteWppSessionRecord } from "@/lib/wppconnect-sessions";
import { getClients, upsertClient } from "@/lib/clients";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const session = await getSession();
  if (!session || session.role !== "manager") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { sessionId } = await params;
  const wppSession = getWppSessionById(sessionId);

  if (wppSession) {
    // Fecha sessão no servidor (best-effort)
    await closeSession(wppSession.sessionName, wppSession.sessionToken).catch(() => {});

    // Remove vínculo de agente em clientes que usavam esta sessão
    const clients = getClients();
    for (const client of clients) {
      if (client.agentConfig?.whatsappConnectionId === sessionId) {
        upsertClient({
          ...client,
          agentConfig: { ...client.agentConfig, whatsappConnectionId: undefined },
        });
      }
    }

    // Remove registro local
    deleteWppSessionRecord(sessionId);
  }

  return NextResponse.json({ ok: true });
}
