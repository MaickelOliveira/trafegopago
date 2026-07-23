import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { getClientById } from "@/lib/clients";
import { PousadaReservaDetailView } from "@/components/pousada/PousadaReservaDetailView";

export default async function PousadaReservaDetailPage({ params }: { params: Promise<{ clientId: string; id: string }> }) {
  const session = await getSession();
  if (!session || session.role !== "manager") redirect("/login");

  const { clientId, id } = await params;
  const client = getClientById(clientId);
  if (!client) redirect("/gestor");
  if (!client.enabledSystems?.includes("pousada")) redirect(`/gestor/${clientId}`);

  return <PousadaReservaDetailView clientId={clientId} reservaId={id} role="manager" />;
}
