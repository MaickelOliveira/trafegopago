import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { getLeads } from "@/lib/leads";
import { getFunnels, createFunnel } from "@/lib/funnels";
import { getClientById } from "@/lib/clients";
import { ClientCrm } from "./ClientCrm";

export default async function ClienteCrmPage() {
  const session = await getSession();
  if (!session || session.role !== "client") redirect("/login");

  const clientId = session.clientId!;
  const client = getClientById(clientId);
  if (!client) redirect("/login");

  const allLeads  = getLeads(clientId);
  let allFunnels  = getFunnels().filter(f => f.clientId === clientId);

  // Auto-cria funil padrão se cliente ainda não tem nenhum
  if (allFunnels.length === 0) {
    const created = createFunnel("Funil Principal");
    const { updateFunnel } = await import("@/lib/funnels");
    updateFunnel(created.id, { clientId });
    allFunnels = [{ ...created, clientId }];
  }

  return (
    <ClientCrm
      clientId={clientId}
      clientName={client.name}
      clientColor={client.color}
      initialLeads={allLeads}
      initialFunnels={allFunnels}
    />
  );
}
