import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { getClients, getConfig } from "@/lib/clients";
import { getFunnels } from "@/lib/funnels";
import { WhatsAppManagerView } from "@/components/whatsapp/WhatsAppManagerView";

export default async function WhatsAppManagerPage() {
  const session = await getSession();
  if (!session || session.role !== "manager") redirect("/login");

  const funnels = getFunnels().map(f => ({
    id: f.id,
    name: f.name,
    clientId: f.clientId ?? null,
  }));

  const clients = getClients().map(c => ({
    id: c.id,
    name: c.name,
    color: c.color,
    agentEnabled: c.agentConfig?.enabled ?? false,
    agentConnectionId: c.agentConfig?.whatsappConnectionId ?? null,
  }));

  const config = getConfig();
  const appWebhookUrl = `${config.appBaseUrl ?? ""}/api/whatsapp/webhook`;

  return (
    <WhatsAppManagerView
      funnels={funnels}
      clients={clients}
      appWebhookUrl={appWebhookUrl}
    />
  );
}
