import { publicFunnel, publicTemplate } from "@/lib/public-records";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { getClientById } from "@/lib/clients";
import { getFunnels } from "@/lib/funnels";
import { getAutomations } from "@/lib/crm-automations";
import { getTemplates } from "@/lib/waba-templates";
import { getWebhooks } from "@/lib/webhooks";
import { getEvolutionSessions } from "@/lib/evolution-sessions";
import { CrmAutomationsView } from "@/components/crm/CrmAutomationsView";

export const dynamic = "force-dynamic";

export default async function ClienteAutomacoesPage() {
  const session = await getSession();
  if (!session || session.role !== "client") redirect("/cliente/crm"); // funcionários sem permissão vão ao CRM

  const clientId = session.clientId!;
  const client = (await getClientById(clientId));
  if (!client) redirect("/login");

  const funnels = (await getFunnels()).filter((f) => f.clientId === clientId);
  const automations = (await getAutomations(clientId));
  const approvedTemplates = (await getTemplates(clientId)).filter((t) => t.status === "APPROVED");
  const webhooks = (await getWebhooks(clientId)).filter((w) => w.active);

  const funnelConnections = funnels.flatMap((f) =>
    (f.connections ?? []).map((c) => ({
      id: c.id,
      type: c.type,
      phone: c.phone,
      funnelId: f.id,
      funnelName: f.name,
    }))
  );

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
      funnels={funnels.map(publicFunnel)}
      connections={connections}
      approvedTemplates={approvedTemplates.map(publicTemplate)}
      webhooks={webhooks}
    />
  );
}
