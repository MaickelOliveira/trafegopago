import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getWppSessionById } from "@/lib/wppconnect-sessions";
import { listGroups } from "@/lib/wppconnect-api";

// GET /api/whatsapp/wppconnect-manager/{sessionId}/groups
// Retorna os grupos WhatsApp da sessão WPPConnect
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const session = await getSession();
  if (!session || session.role !== "manager") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { sessionId } = await params;
  const wppSession = getWppSessionById(sessionId);
  if (!wppSession) {
    return NextResponse.json({ error: "Sessão não encontrada" }, { status: 404 });
  }

  const groups = await listGroups(wppSession.sessionName, wppSession.sessionToken);
  return NextResponse.json({ groups });
}
