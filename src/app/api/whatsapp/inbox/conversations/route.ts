import { NextRequest, NextResponse } from "next/server";
import { getAllConversationsByClientId, setAiPaused } from "@/lib/conversations";
import { getFunnels } from "@/lib/funnels";
import { getLeadByPhone } from "@/lib/leads";
import { getWppSessions } from "@/lib/wppconnect-sessions";
import { getEvolutionSessions } from "@/lib/evolution-sessions";

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

  // Adiciona instâncias Evolution vinculadas a funis deste cliente
  const evoSessions = getEvolutionSessions().filter(s => s.funnelId && clientFunnelIds.has(s.funnelId));
  for (const s of evoSessions) {
    if (!connIds.has(s.id)) {
      connIds.add(s.id);
      connections.push({ id: s.id, phone: s.instanceName, type: "evolution" });
    }
  }

  // Pega todas as conversas do cliente — sem filtrar por connId ativo,
  // para que conversas de sessões desconectadas/deletadas continuem visíveis.
  const conversations = getAllConversationsByClientId(clientId);

  // Adiciona conexões "históricas" derivadas das conversas (sessões que foram
  // deletadas mas ainda têm conversas salvas localmente).
  for (const conv of conversations) {
    if (conv.connId && !connIds.has(conv.connId)) {
      connIds.add(conv.connId);
      connections.push({ id: conv.connId, phone: conv.connId, type: "wppconnect" });
    }
  }

  const filtered = conversations
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
        setAiPaused(c.phone, lead.aiPaused, clientId, c.connId); // corrige conversations.json
        return { ...c, contactName, aiPaused: lead.aiPaused, ...(realPhone ? { realPhone } : {}) };
      }
      return { ...c, contactName, ...(realPhone ? { realPhone } : {}) };
    });

  return NextResponse.json({ conversations: filtered, connections });
}
