import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { getClientById } from "@/lib/clients";
import { PousadaReservaDetailView } from "@/components/pousada/PousadaReservaDetailView";

export const dynamic = "force-dynamic";

export default async function ClientePousadaReservaDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || (session.role !== "client" && session.role !== "employee")) redirect("/login");

  const clientId = session.clientId!;
  const client = getClientById(clientId);
  if (!client) redirect("/login");
  if (!client.enabledSystems?.includes("pousada")) redirect("/cliente");

  const { id } = await params;
  return <PousadaReservaDetailView clientId={clientId} reservaId={id} role="client" />;
}
