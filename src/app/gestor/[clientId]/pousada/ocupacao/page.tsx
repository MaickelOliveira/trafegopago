import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { getClientById } from "@/lib/clients";
import { PousadaOcupacaoView } from "@/components/pousada/PousadaOcupacaoView";

export default async function PousadaOcupacaoPage({ params }: { params: Promise<{ clientId: string }> }) {
  const session = await getSession();
  if (!session || session.role !== "manager") redirect("/login");

  const { clientId } = await params;
  const client = getClientById(clientId);
  if (!client) redirect("/gestor");
  if (!client.enabledSystems?.includes("pousada")) redirect(`/gestor/${clientId}`);

  return <PousadaOcupacaoView clientId={clientId} role="manager" />;
}
