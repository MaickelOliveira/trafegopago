import { notFound } from "next/navigation";
import { getClientById } from "@/lib/clients";
import { AutomacoesView } from "@/components/shared/AutomacoesView";

type Props = { params: Promise<{ clientId: string }> };

export default async function GestorAutomacoesPage({ params }: Props) {
  const { clientId } = await params;
  const client = getClientById(clientId);
  if (!client) notFound();

  const { passwordHash: _, ...safe } = client;

  return <AutomacoesView client={safe} role="manager" />;
}
