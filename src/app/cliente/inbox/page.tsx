import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { getAllConversationsByClientId } from "@/lib/conversations";
import { getFunnels } from "@/lib/funnels";
import { getWppSessions } from "@/lib/wppconnect-sessions";
import { getEvolutionSessions } from "@/lib/evolution-sessions";
import InboxView from "@/components/inbox/InboxView";

export const dynamic = "force-dynamic";

export default async function ClienteInboxPage() {
  const session = await getSession();
  if (!session || (session.role !== "client" && session.role !== "employee") || !session.clientId) redirect("/login");

  const clientId = session.clientId;
  const conversations = getAllConversationsByClientId(clientId);

  const funnels = getFunnels().filter((f) => f.clientId === clientId);
  const seenIds = new Set<string>();
  const connections: { id: string; phone: string; type: string }[] = [];
  for (const f of funnels) {
    for (const c of f.connections ?? []) {
      if (!seenIds.has(c.id)) {
        seenIds.add(c.id);
        connections.push({ id: c.id, phone: c.phone || c.id, type: c.type });
      }
    }
  }

  // Sessões WPPConnect e Evolution vinculadas aos funis deste cliente — não
  // vivem em funnels[].connections, precisam ser mescladas separadamente.
  const clientFunnelIds = new Set(funnels.map((f) => f.id));
  for (const s of getWppSessions()) {
    if (s.funnelId && clientFunnelIds.has(s.funnelId) && !seenIds.has(s.id)) {
      seenIds.add(s.id);
      connections.push({ id: s.id, phone: s.sessionName, type: "wppconnect" });
    }
  }
  for (const s of getEvolutionSessions()) {
    if (s.funnelId && clientFunnelIds.has(s.funnelId) && !seenIds.has(s.id)) {
      seenIds.add(s.id);
      connections.push({ id: s.id, phone: s.instanceName, type: "evolution" });
    }
  }

  return (
    <div className="flex flex-col" style={{ height: "calc(100vh - 64px)" }}>
      <div className="flex-1 overflow-hidden">
        <InboxView clientId={clientId} initialConversations={conversations} initialConnections={connections} />
      </div>
    </div>
  );
}
