import { notFound } from "next/navigation";
import { getClientById, getConfig } from "@/lib/clients";
import { UtmBuilder } from "@/components/utm/UtmBuilder";

type Props = { params: Promise<{ clientId: string }> };

export default async function UtmBuilderPage({ params }: Props) {
  const { clientId } = await params;
  const client = getClientById(clientId);
  if (!client) notFound();

  const config = getConfig();
  const baseUrl = config.appBaseUrl?.replace(/\/$/, "") ?? "";
  const webhookUrl = baseUrl ? `${baseUrl}/api/crm/webhook/form?clientId=${clientId}` : `/api/crm/webhook/form?clientId=${clientId}`;

  return <UtmBuilder clientId={clientId} clientName={client.name} webhookUrl={webhookUrl} />;
}
