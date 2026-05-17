import { notFound } from "next/navigation";
import { getClientById } from "@/lib/clients";
import { ClientAccountView } from "@/components/shared/ClientAccountView";

type Props = { params: Promise<{ clientId: string }> };

export default async function GestorClientPage({ params }: Props) {
  const { clientId } = await params;
  const client = getClientById(clientId);
  if (!client) notFound();

  const { passwordHash: _, ...safe } = client;

  return <ClientAccountView client={safe} role="manager" />;
}
