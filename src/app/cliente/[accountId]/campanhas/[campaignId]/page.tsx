import { redirect, notFound } from "next/navigation";
import { getSession } from "@/lib/auth";
import { getClientById } from "@/lib/clients";
import { CampaignDetailView } from "@/components/shared/CampaignDetailView";

type Props = { params: Promise<{ accountId: string; campaignId: string }> };

export default async function ClienteCampaignPage({ params }: Props) {
  const session = await getSession();
  if (!session || session.role !== "client") redirect("/login");

  const { accountId, campaignId } = await params;
  const client = (await getClientById(session.clientId!));
  if (!client) redirect("/login");

  const account = client.adAccounts.find((a) => a.id === accountId);
  if (!account) notFound();

  const safe = { id: client.id, name: client.name, color: client.color, cplTarget: client.cplTarget, funnelType: client.funnelType };

  return (
    <CampaignDetailView
      client={safe}
      accountId={accountId}
      campaignId={campaignId}
      role="client"
      platform={account.platform}
    />
  );
}
