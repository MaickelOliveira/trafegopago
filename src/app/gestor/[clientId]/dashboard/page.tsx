import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { getClientById } from "@/lib/clients";
import { DashboardView } from "@/components/shared/DashboardView";

export default async function DashboardPage({ params }: { params: Promise<{ clientId: string }> }) {
  const session = await getSession();
  if (!session || session.role !== "manager") redirect("/login");

  const { clientId } = await params;
  const client = getClientById(clientId);
  if (!client) redirect("/gestor");

  return (
    <DashboardView
      client={{
        id: client.id,
        name: client.name,
        color: client.color,
        cplTarget: client.cplTarget,
        funnelType: client.funnelType,
        adAccounts: client.adAccounts,
      }}
    />
  );
}
