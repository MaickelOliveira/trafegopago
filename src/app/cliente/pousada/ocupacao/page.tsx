import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { getClientById } from "@/lib/clients";
import { PousadaOcupacaoView } from "@/components/pousada/PousadaOcupacaoView";

export const dynamic = "force-dynamic";

export default async function ClientePousadaOcupacaoPage() {
  const session = await getSession();
  if (!session || (session.role !== "client" && session.role !== "employee")) redirect("/login");

  const clientId = session.clientId!;
  const client = getClientById(clientId);
  if (!client) redirect("/login");
  if (!client.enabledSystems?.includes("pousada")) redirect("/cliente");

  return <PousadaOcupacaoView clientId={clientId} role="client" />;
}
