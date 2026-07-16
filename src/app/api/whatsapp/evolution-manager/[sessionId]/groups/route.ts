import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getEvolutionSessionById } from "@/lib/evolution-sessions";
import { listGroups } from "@/lib/evolution-api";

// GET /api/whatsapp/evolution-manager/{sessionId}/groups
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const session = await getSession();
  if (!session || session.role !== "manager") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { sessionId } = await params;
  const evoSession = getEvolutionSessionById(sessionId);
  if (!evoSession) {
    return NextResponse.json({ error: "Sessão não encontrada" }, { status: 404 });
  }

  const groups = await listGroups(evoSession.instanceName, evoSession.instanceApiKey);
  console.log(`[groups] instance=${evoSession.instanceName} found=${groups.length}`);
  return NextResponse.json({ groups });
}
