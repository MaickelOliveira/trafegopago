import { notFound } from "next/navigation";
import { getClientById, getConfig } from "@/lib/clients";
import { getFunnels } from "@/lib/funnels";
import { getWebhooks } from "@/lib/webhooks";
import { WebhooksView } from "@/components/webhooks/WebhooksView";

type Props = { params: Promise<{ clientId: string }> };

export default async function WebhooksPage({ params }: Props) {
  const { clientId } = await params;
  const client = getClientById(clientId);
  if (!client) notFound();

  const funnels = getFunnels().filter((f) => f.clientId === clientId);
  const webhooks = getWebhooks(clientId);
  const config = getConfig();
  const baseUrl = config.appBaseUrl?.replace(/\/$/, "") ?? "";

  return (
    <WebhooksView
      clientId={clientId}
      funnels={funnels}
      initialWebhooks={webhooks}
      baseUrl={baseUrl}
    />
  );
}
