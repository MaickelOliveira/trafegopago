import { redirect, notFound } from "next/navigation";
import { getSession } from "@/lib/auth";
import { getClientById } from "@/lib/clients";
import { CampaignDetailView } from "@/components/shared/CampaignDetailView";

type Props = { params: Promise<{ accountId: string; campaignId: string }> };

export default async function ClienteCampaignPage({ params }: Props) {
  const session = await getSession();
  if (!session || session.role !== "client") redirect("/login");

  const { accountId, campaignId } = await params;
  const client = getClientById(session.clientId!);
  if (!client) redirect("/login");

  const owns = client.adAccounts.some((a) => a.id === accountId);
  if (!owns) notFound();

  const { passwordHash: _, ...safe } = client;

  return (
    <CampaignDetailView
      client={safe}
      accountId={accountId}
      campaignId={campaignId}
      role="client"
    />
  );
}
