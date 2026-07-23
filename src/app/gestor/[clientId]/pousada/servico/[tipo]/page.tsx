import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { getClientById } from "@/lib/clients";
import { PousadaServicoView } from "@/components/pousada/PousadaServicoView";

export default async function PousadaServicoPage({ params }: { params: Promise<{ clientId: string; tipo: string }> }) {
  const session = await getSession();
  if (!session || session.role !== "manager") redirect("/login");

  const { clientId, tipo } = await params;
  const client = getClientById(clientId);
  if (!client) redirect("/gestor");
  if (!client.enabledSystems?.includes("pousada")) redirect(`/gestor/${clientId}`);

  return <PousadaServicoView clientId={clientId} tipoSlug={decodeURIComponent(tipo)} role="manager" />;
}
