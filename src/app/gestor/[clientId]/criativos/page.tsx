import { notFound } from "next/navigation";
import { getClientById } from "@/lib/clients";
import { CriativosView } from "@/components/shared/CriativosView";

type Props = { params: Promise<{ clientId: string }> };

export default async function GestorCriativosPage({ params }: Props) {
  const { clientId } = await params;
  const client = getClientById(clientId);
  if (!client) notFound();

  const adAccountId = client.adAccounts[0]?.id || "";

  return (
    <CriativosView
      clientId={client.id}
      clientName={client.name}
      clientColor={client.color}
      adAccountId={adAccountId}
      role="manager"
      backPath={`/gestor/${client.id}`}
    />
  );
}
