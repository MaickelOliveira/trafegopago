import { NextResponse } from "next/server";
import { getWppSessions } from "@/lib/wppconnect-sessions";
import { checkConnectionStatus, listSessions } from "@/lib/wppconnect-api";

export const dynamic = "force-dynamic";

/** Debug: lista sessões WPPConnect locais (sem token) + status ao vivo + sessões no servidor WPPConnect. */
export async function GET() {
  const local = getWppSessions();

  const sessions = await Promise.all(
    local.map(async (s) => ({
      id: s.id,
      sessionName: s.sessionName,
      funnelId: s.funnelId,
      clientId: s.clientId,
      status: await checkConnectionStatus(s.sessionName, s.sessionToken).catch(() => "ERROR"),
    }))
  );

  const nameCount = new Map<string, number>();
  for (const s of local) nameCount.set(s.sessionName, (nameCount.get(s.sessionName) ?? 0) + 1);
  const duplicateSessionNames = [...nameCount.entries()].filter(([, n]) => n > 1).map(([name]) => name);

  const serverSessions = await listSessions().catch(() => []);

  return NextResponse.json({
    totalLocal: local.length,
    duplicateSessionNames,
    sessions,
    serverSessions,
  });
}
