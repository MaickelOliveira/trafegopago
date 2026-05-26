import { notFound } from "next/navigation";
import { getClientById } from "@/lib/clients";
import { getAllConversationsByClientId } from "@/lib/conversations";
import InboxView from "@/components/inbox/InboxView";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ clientId: string }> };

export default async function GestorInboxPage({ params }: Props) {
  const { clientId } = await params;
  const client = getClientById(clientId);
  if (!client) notFound();

  const conversations = getAllConversationsByClientId(clientId);

  return (
    <div className="flex flex-col h-screen">
      <div className="px-6 py-3 bg-slate-900 border-b border-slate-700 flex items-center gap-3">
        <h1 className="text-white font-semibold text-base">
          💬 Mensagens — {client.name}
        </h1>
      </div>
      <div className="flex-1 overflow-hidden">
        <InboxView clientId={clientId} initialConversations={conversations} />
      </div>
    </div>
  );
}
