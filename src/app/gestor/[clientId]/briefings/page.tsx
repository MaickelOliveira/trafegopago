import { notFound } from "next/navigation";
import { getClientById } from "@/lib/clients";
import { BriefingsView } from "@/components/gestor/BriefingsView";
import { listBriefingsByClient } from "@/lib/briefings";

type Props = { params: Promise<{ clientId: string }> };

export default async function GestorBriefingsPage({ params }: Props) {
  const { clientId } = await params;
  const client = getClientById(clientId);
  if (!client) notFound();

  const briefings = listBriefingsByClient(clientId);

  return (
    <BriefingsView
      clientId={clientId}
      clientName={client.name}
      briefings={briefings}
    />
  );
}
