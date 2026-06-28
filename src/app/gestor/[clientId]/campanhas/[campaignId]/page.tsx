import { notFound } from "next/navigation";
import { getClientById } from "@/lib/clients";
import { CampaignDetailView } from "@/components/shared/CampaignDetailView";

type Props = { params: Promise<{ clientId: string; campaignId: string }> };

export default async function GestorCampaignPage({ params }: Props) {
  const { clientId, campaignId } = await params;
  const client = getClientById(clientId);
  if (!client) notFound();

  const accountId = client.adAccounts[0]?.id;
  if (!accountId) notFound();
  const platform = client.adAccounts.find((a) => a.id === accountId)?.platform ?? "meta";

  const { passwordHash: _, ...safe } = client;

  return (
    <CampaignDetailView
      client={safe}
      accountId={accountId}
      campaignId={campaignId}
      role="manager"
      platform={platform}
    />
  );
}
