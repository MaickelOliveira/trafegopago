import { NextRequest, NextResponse } from "next/server";
import { getAllConversationsByClientId } from "@/lib/conversations";
import { getFunnels } from "@/lib/funnels";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const clientId = req.nextUrl.searchParams.get("clientId");
  if (!clientId) return NextResponse.json({ error: "clientId required" }, { status: 400 });

  // Busca todas as conexões deste cliente
  const funnels = getFunnels().filter((f) => f.clientId === clientId);
  const connIds = new Set<string>();
  for (const f of funnels) {
    for (const c of f.connections ?? []) {
      connIds.add(c.id);
    }
  }

  // Pega todas as conversas do cliente e filtra apenas as que pertencem às conexões deste cliente
  const conversations = getAllConversationsByClientId(clientId);
  // Inclui conversas sem connId também (mensagens antigas antes do campo existir)
  const filtered = conversations.filter((c) => !c.connId || connIds.has(c.connId));

  return NextResponse.json({ conversations: filtered });
}
