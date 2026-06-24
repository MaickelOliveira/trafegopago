import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { getClientById } from "@/lib/clients";
import { getLeads } from "@/lib/leads";
import { AgentView } from "@/components/agent/AgentView";
import { AttentionBoard } from "@/components/shared/AttentionBoard";
import { Suspense } from "react";

export default async function AgentePage({ params }: { params: Promise<{ clientId: string }> }) {
  const session = await getSession();
  if (!session || session.role !== "manager") redirect("/login");

  const { clientId } = await params;
  const client = getClientById(clientId);
  if (!client) redirect("/gestor");

  const leads = getLeads(clientId);

  return (
    <Suspense>
      <div className="max-w-2xl mx-auto px-6 pt-6">
        <AttentionBoard initialLeads={leads} />
      </div>
      <AgentView clientId={clientId} clientName={client.name} />
    </Suspense>
  );
}
