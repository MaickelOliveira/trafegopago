import { notFound } from "next/navigation";
import { getClientById } from "@/lib/clients";
import { getFunnels } from "@/lib/funnels";
import { getAutomations } from "@/lib/crm-automations";
import { getTemplates } from "@/lib/waba-templates";
import { CrmAutomationsView } from "@/components/crm/CrmAutomationsView";

type Props = { params: Promise<{ clientId: string }> };

export default async function CrmAutomacoesPage({ params }: Props) {
  const { clientId } = await params;
  const client = getClientById(clientId);
  if (!client) notFound();

  const funnels = getFunnels().filter((f) => f.clientId === clientId);
  const automations = getAutomations(clientId);
  const approvedTemplates = getTemplates(clientId).filter((t) => t.status === "APPROVED");

  // Conexões disponíveis (UazapiGO e Meta) de todos os funis
  const connections = funnels.flatMap((f) =>
    (f.connections ?? []).map((c) => ({
      id: c.id,
      type: c.type,
      phone: c.phone,
      funnelId: f.id,
      funnelName: f.name,
    }))
  );

  return (
    <CrmAutomationsView
      clientId={clientId}
      initialAutomations={automations}
      funnels={funnels}
      connections={connections}
      approvedTemplates={approvedTemplates}
    />
  );
}
