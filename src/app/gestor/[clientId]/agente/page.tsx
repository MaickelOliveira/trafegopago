import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { getClientById } from "@/lib/clients";
import { AgentView } from "@/components/agent/AgentView";
import { Suspense } from "react";

export default async function AgentePage({ params }: { params: Promise<{ clientId: string }> }) {
  const session = await getSession();
  if (!session || session.role !== "manager") redirect("/login");

  const { clientId } = await params;
  const client = getClientById(clientId);
  if (!client) redirect("/gestor");

  return (
    <Suspense>
      <AgentView clientId={clientId} clientName={client.name} />
    </Suspense>
  );
}
