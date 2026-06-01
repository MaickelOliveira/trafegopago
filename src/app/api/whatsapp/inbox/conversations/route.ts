import { NextRequest, NextResponse } from "next/server";
import { getAllConversationsByClientId, setAiPaused } from "@/lib/conversations";
import { getFunnels } from "@/lib/funnels";
import { getLeadByPhone } from "@/lib/leads";
import { getWppSessions } from "@/lib/wppconnect-sessions";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const clientId = req.nextUrl.searchParams.get("clientId");
  if (!clientId) return NextResponse.json({ error: "clientId required" }, { status: 400 });

  // Busca todas as conexões deste cliente
  const funnels = getFunnels().filter((f) => f.clientId === clientId);
  const connections: { id: string; phone: string; type: string }[] = [];
  const connIds = new Set<string>();

  for (const f of funnels) {
    for (const c of f.connections ?? []) {
      if (!connIds.has(c.id)) {
        connIds.add(c.id);
        connections.push({ id: c.id, phone: c.phone || c.id, type: c.type });
      }
    }
  }

  // Adiciona sessões WPPConnect vinculadas a funis deste cliente
  const clientFunnelIds = new Set(funnels.map(f => f.id));
  const wppSessions = getWppSessions().filter(s => s.funnelId && clientFunnelIds.has(s.funnelId));
  for (const s of wppSessions) {
    if (!connIds.has(s.id)) {
      connIds.add(s.id);
      connections.push({ id: s.id, phone: s.sessionName, type: "wppconnect" });
    }
  }

  // Pega todas as conversas do cliente filtradas pelas conexões deste cliente
  const conversations = getAllConversationsByClientId(clientId);
  const filtered = conversations
    .filter((c) => !c.connId || connIds.has(c.connId))
    .map((c) => {
      // Sincroniza aiPaused com o lead — CRM é a fonte de verdade
      const lead = getLeadByPhone(clientId, c.phone);
      const realPhone = lead?.realPhone;
      // Enriquece o contactName com o nome do lead quando a conversa não tem nome
      // (ocorre em contatos LID ou quando o operador mandou primeiro)
      const leadName = lead?.name;
      const validLeadName =
        leadName &&
        leadName !== c.phone &&
        leadName !== (realPhone ?? "") &&
        !/^\d+$/.test(leadName)
          ? leadName
          : undefined;
      const contactName = c.contactName ?? validLeadName ?? null;
      if (lead && lead.aiPaused !== undefined && lead.aiPaused !== c.aiPaused) {
        setAiPaused(c.phone, lead.aiPaused); // corrige conversations.json
        return { ...c, contactName, aiPaused: lead.aiPaused, ...(realPhone ? { realPhone } : {}) };
      }
      return { ...c, contactName, ...(realPhone ? { realPhone } : {}) };
    });

  return NextResponse.json({ conversations: filtered, connections });
}
