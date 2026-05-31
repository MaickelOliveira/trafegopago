import { notFound } from "next/navigation";
import { getClientById } from "@/lib/clients";
import { getFunnels } from "@/lib/funnels";
import { getAutomations } from "@/lib/crm-automations";
import { getTemplates } from "@/lib/waba-templates";
import { getWebhooks } from "@/lib/webhooks";
import { getWppSessions } from "@/lib/wppconnect-sessions";
import { CrmAutomationsView } from "@/components/crm/CrmAutomationsView";

type Props = { params: Promise<{ clientId: string }> };

export default async function CrmAutomacoesPage({ params }: Props) {
  const { clientId } = await params;
  const client = getClientById(clientId);
  if (!client) notFound();

  const funnels = getFunnels().filter((f) => f.clientId === clientId);
  const automations = getAutomations(clientId);
  const approvedTemplates = getTemplates(clientId).filter((t) => t.status === "APPROVED");
  const webhooks = getWebhooks(clientId).filter((w) => w.active);

  // Conexões disponíveis (UazapiGO e Meta) de todos os funis
  const funnelConnections = funnels.flatMap((f) =>
    (f.connections ?? []).map((c) => ({
      id: c.id,
      type: c.type,
      phone: c.phone,
      funnelId: f.id,
      funnelName: f.name,
    }))
  );

  // Sessões WPPConnect vinculadas a este cliente
  const wppConnections = getWppSessions()
    .filter((s) => s.clientId === clientId)
    .map((s) => ({
      id: s.id,
      type: "wppconnect" as const,
      phone: s.sessionName,
      funnelId: s.funnelId ?? "",
      funnelName: funnels.find((f) => f.id === s.funnelId)?.name ?? "WPPConnect",
    }));

  const connections = [...funnelConnections, ...wppConnections];

  return (
    <CrmAutomationsView
      clientId={clientId}
      initialAutomations={automations}
      funnels={funnels}
      connections={connections}
      approvedTemplates={approvedTemplates}
      webhooks={webhooks}
    />
  );
}
