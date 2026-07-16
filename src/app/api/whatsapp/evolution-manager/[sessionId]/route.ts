import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { deleteInstance } from "@/lib/evolution-api";
import { getEvolutionSessionById, deleteEvolutionSessionRecord } from "@/lib/evolution-sessions";
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
  const evoSession = getEvolutionSessionById(sessionId);

  if (evoSession) {
    await deleteInstance(evoSession.instanceName).catch(() => {});

    const clients = getClients();
    for (const client of clients) {
      if (client.agentConfig?.whatsappConnectionId === sessionId) {
        upsertClient({
          ...client,
          agentConfig: { ...client.agentConfig, whatsappConnectionId: undefined },
        });
      }
    }

    deleteEvolutionSessionRecord(sessionId);
  }

  return NextResponse.json({ ok: true });
}
