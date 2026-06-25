import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { getClients, getClientById } from "@/lib/clients";
import { getLeads, attachLeadsHeat } from "@/lib/leads";
import { getFunnels } from "@/lib/funnels";
import { CrmClient } from "@/app/gestor/crm/CrmClient";

export default async function ClientCrmPage({ params }: { params: Promise<{ clientId: string }> }) {
  const session = await getSession();
  if (!session || session.role !== "manager") redirect("/login");

  const { clientId } = await params;
  const client = getClientById(clientId);
  if (!client) redirect("/gestor");

  // Passa apenas este cliente como opção — sem seletor de cliente
  const clients = [{
    id: client.id,
    name: client.name,
    color: client.color,
    metaAccountId: client.adAccounts.find((a) => a.platform === "meta")?.id,
    pixelId: client.pixelId,
    kanbanAgentEnabled: client.kanbanAgentEnabled !== false,
  }];

  const leads = attachLeadsHeat(getLeads(clientId));
  const funnels = getFunnels().filter((f) => f.clientId === clientId);

  return (
    <CrmClient
      clients={clients}
      initialLeads={leads}
      initialFunnels={funnels}
      selectedClient={clientId}
    />
  );
}
