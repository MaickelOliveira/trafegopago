import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { getClientById } from "@/lib/clients";
import { DashboardView } from "@/components/shared/DashboardView";

export const dynamic = "force-dynamic";

export default async function ClienteDashboard() {
  const session = await getSession();
  if (!session || (session.role !== "client" && session.role !== "employee")) redirect("/login");

  const clientId = session.clientId!;
  const client = getClientById(clientId);
  if (!client) redirect("/login");

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
