import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { getAllConversationsByClientId } from "@/lib/conversations";
import InboxView from "@/components/inbox/InboxView";

export const dynamic = "force-dynamic";

export default async function ClienteInboxPage() {
  const session = await getSession();
  if (!session || session.role !== "client" || !session.clientId) redirect("/login");

  const clientId = session.clientId;
  const conversations = getAllConversationsByClientId(clientId);

  return (
    <div className="flex flex-col" style={{ height: "calc(100vh - 64px)" }}>
      <div className="flex-1 overflow-hidden">
        <InboxView clientId={clientId} initialConversations={conversations} />
      </div>
    </div>
  );
}
