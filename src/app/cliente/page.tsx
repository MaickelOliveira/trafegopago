import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { getClientById } from "@/lib/clients";
import { DashboardView } from "@/components/shared/DashboardView";

export default async function ClienteDashboard() {
  const session = await getSession();
  if (!session || session.role !== "client") redirect("/login");

  const client = getClientById(session.clientId!);
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
