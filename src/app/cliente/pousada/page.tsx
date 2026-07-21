import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { getClientById } from "@/lib/clients";
import { PousadaDashboardView } from "@/components/pousada/PousadaDashboardView";

export const dynamic = "force-dynamic";

export default async function ClientePousadaPage() {
  const session = await getSession();
  if (!session || (session.role !== "client" && session.role !== "employee")) redirect("/login");

  const clientId = session.clientId!;
  const client = getClientById(clientId);
  if (!client) redirect("/login");
  if (!client.enabledSystems?.includes("pousada")) redirect("/cliente");

  return <PousadaDashboardView clientId={clientId} role="client" />;
}
