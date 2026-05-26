import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { getAllConversationsByClientId } from "@/lib/conversations";
import { getFunnels } from "@/lib/funnels";
import InboxView from "@/components/inbox/InboxView";

export const dynamic = "force-dynamic";

export default async function ClienteInboxPage() {
  const session = await getSession();
  if (!session || session.role !== "client" || !session.clientId) redirect("/login");

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

  return (
    <div className="flex flex-col" style={{ height: "calc(100vh - 64px)" }}>
      <div className="flex-1 overflow-hidden">
        <InboxView clientId={clientId} initialConversations={conversations} initialConnections={connections} />
      </div>
    </div>
  );
}
