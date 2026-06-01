import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { getClientById } from "@/lib/clients";
import { getFunnels } from "@/lib/funnels";
import { getAutomations } from "@/lib/crm-automations";
import { getTemplates } from "@/lib/waba-templates";
import { getWebhooks } from "@/lib/webhooks";
import { getWppSessions } from "@/lib/wppconnect-sessions";
import { CrmAutomationsView } from "@/components/crm/CrmAutomationsView";

export const dynamic = "force-dynamic";

export default async function ClienteAutomacoesPage() {
  const session = await getSession();
  if (!session || session.role !== "client") redirect("/cliente/crm"); // funcionários sem permissão vão ao CRM

  const clientId = session.clientId!;
  const client = getClientById(clientId);
  if (!client) redirect("/login");

  const funnels = getFunnels().filter((f) => f.clientId === clientId);
  const automations = getAutomations(clientId);
  const approvedTemplates = getTemplates(clientId).filter((t) => t.status === "APPROVED");
  const webhooks = getWebhooks(clientId).filter((w) => w.active);

  const funnelConnections = funnels.flatMap((f) =>
    (f.connections ?? []).map((c) => ({
      id: c.id,
      type: c.type as "uazapi" | "meta" | "wppconnect",
      phone: c.phone,
      funnelId: f.id,
      funnelName: f.name,
    }))
  );

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
