import { notFound } from "next/navigation";
import { getClientById } from "@/lib/clients";
import { getFunnels } from "@/lib/funnels";
import { getAutomations } from "@/lib/crm-automations";
import { getTemplates } from "@/lib/waba-templates";
import { getWebhooks } from "@/lib/webhooks";
import { getEvolutionSessions } from "@/lib/evolution-sessions";
import { CrmAutomationsView } from "@/components/crm/CrmAutomationsView";

type Props = { params: Promise<{ clientId: string }> };

export default async function CrmAutomacoesPage({ params }: Props) {
  const { clientId } = await params;
  const client = (await getClientById(clientId));
  if (!client) notFound();

  const funnels = (await getFunnels()).filter((f) => f.clientId === clientId);
  const automations = (await getAutomations(clientId));
  const approvedTemplates = (await getTemplates(clientId)).filter((t) => t.status === "APPROVED");
  const webhooks = (await getWebhooks(clientId)).filter((w) => w.active);

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

  // Sessões WPPConnect vinculadas a este cliente (por clientId ou por funnelId)
  const clientFunnelIds = new Set(funnels.map((f) => f.id));
  const evolutionConnections = (await getEvolutionSessions())
    .filter((s) => (!s.clientId || s.clientId === clientId) && s.funnelId && clientFunnelIds.has(s.funnelId))
    .map((s) => ({
      id: s.id,
      type: "evolution" as const,
      phone: s.instanceName,
      funnelId: s.funnelId ?? "",
      funnelName: funnels.find((f) => f.id === s.funnelId)?.name ?? "Evolution API",
    }));

  const connections = [...funnelConnections, ...evolutionConnections];

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
