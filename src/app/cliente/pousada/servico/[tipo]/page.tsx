import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { getClientById } from "@/lib/clients";
import { PousadaServicoView } from "@/components/pousada/PousadaServicoView";

export const dynamic = "force-dynamic";

export default async function ClientePousadaServicoPage({ params }: { params: Promise<{ tipo: string }> }) {
  const session = await getSession();
  if (!session || (session.role !== "client" && session.role !== "employee")) redirect("/login");

  const clientId = session.clientId!;
  const client = getClientById(clientId);
  if (!client) redirect("/login");
  if (!client.enabledSystems?.includes("pousada")) redirect("/cliente");

  const { tipo } = await params;
  return <PousadaServicoView clientId={clientId} tipoSlug={decodeURIComponent(tipo)} role="client" />;
}
