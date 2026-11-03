import { getSession } from "@/lib/auth";
import { getEmployeeById, employeeCanAccessFunnel } from "@/lib/employees";
import { getChatLeadForConnection } from "@/lib/lead-context";
import { NextRequest, NextResponse } from "next/server";
import { getAllConversationsByClientId, setAiPaused } from "@/lib/conversations";
import { getFunnels } from "@/lib/funnels";
import { getLeadByPhone } from "@/lib/leads";
import { getEvolutionSessions } from "@/lib/evolution-sessions";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const clientId = req.nextUrl.searchParams.get("clientId");
  if (!clientId) return NextResponse.json({ error: "clientId required" }, { status: 400 });

  const session = await getSession();
  if (!session || session.role !== "manager" && session.clientId !== clientId) return NextResponse.json({ error: "Não autorizado." }, { status: 403 });
  const employee = session.role === "employee" ? await getEmployeeById(session.employeeId!) : undefined;
  // Busca todas as conexões deste cliente
  const funnels = (await getFunnels()).filter(f => f.clientId === clientId && (!employee || employeeCanAccessFunnel(employee, f.id)));
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

  const clientFunnelIds=new Set(funnels.map(funnel=>funnel.id));
  // Adiciona instâncias Evolution vinculadas a funis deste cliente
  const evoSessions = (await getEvolutionSessions()).filter(s => s.funnelId && clientFunnelIds.has(s.funnelId));
  for (const s of evoSessions) {
    if (!connIds.has(s.id)) {
      connIds.add(s.id);
      connections.push({ id: s.id, phone: s.instanceName, type: "evolution" });
    }
  }

  // Pega todas as conversas do cliente — sem filtrar por connId ativo,
  // para que conversas de sessões desconectadas/deletadas continuem visíveis.
  const conversations = (await getAllConversationsByClientId(clientId)).filter(conversation => !employee || !!conversation.connId && connIds.has(conversation.connId));

  // Adiciona conexões "históricas" derivadas das conversas (sessões que foram
  // deletadas mas ainda têm conversas salvas localmente).
  for (const conv of conversations) {
    if (conv.connId && !connIds.has(conv.connId)) {
      connIds.add(conv.connId);
      connections.push({ id: conv.connId, phone: "Histórico arquivado", type: "archived" });
    }
  }

  const filtered = (await Promise.all(conversations
    .map(async (c) => {
      // Sincroniza aiPaused com o lead — CRM é a fonte de verdade
      const lead = (await getChatLeadForConnection(clientId, c.phone, c.connId));
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
        (await setAiPaused(c.phone, lead.aiPaused, clientId, c.connId)); // corrige conversations.json
        return { ...c, contactName, aiPaused: lead.aiPaused, ...(realPhone ? { realPhone } : {}) };
      }
      return { ...c, contactName, ...(realPhone ? { realPhone } : {}) };
    })));

  return NextResponse.json({ conversations: filtered, connections });
}
