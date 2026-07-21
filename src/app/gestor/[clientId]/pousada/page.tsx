import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { getClientById } from "@/lib/clients";
import { PousadaDashboardView } from "@/components/pousada/PousadaDashboardView";

export default async function PousadaPage({ params }: { params: Promise<{ clientId: string }> }) {
  const session = await getSession();
  if (!session || session.role !== "manager") redirect("/login");

  const { clientId } = await params;
  const client = getClientById(clientId);
  if (!client) redirect("/gestor");
  if (!client.enabledSystems?.includes("pousada")) redirect(`/gestor/${clientId}`);

  return <PousadaDashboardView clientId={clientId} role="manager" />;
}
