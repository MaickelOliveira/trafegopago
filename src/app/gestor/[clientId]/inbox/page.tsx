import { notFound } from "next/navigation";
import { getClientById } from "@/lib/clients";
import { getAllConversationsByClientId } from "@/lib/conversations";
import { getFunnels } from "@/lib/funnels";
import InboxView from "@/components/inbox/InboxView";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ clientId: string }> };

export default async function GestorInboxPage({ params }: Props) {
  const { clientId } = await params;
  const client = getClientById(clientId);
  if (!client) notFound();

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
    <div className="flex flex-col h-full">
      <div className="px-6 py-3 bg-slate-900 border-b border-slate-700 flex items-center gap-3">
        <h1 className="text-white font-semibold text-base">
          💬 Mensagens — {client.name}
        </h1>
      </div>
      <div className="flex-1 overflow-hidden">
        <InboxView clientId={clientId} initialConversations={conversations} initialConnections={connections} />
      </div>
    </div>
  );
}
