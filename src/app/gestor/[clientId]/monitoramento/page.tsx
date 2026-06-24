import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { getClientById } from "@/lib/clients";
import { MonitoringCenter } from "@/components/shared/MonitoringCenter";

export default async function GestorMonitoramentoPage({ params }: { params: Promise<{ clientId: string }> }) {
  const session = await getSession();
  if (!session || session.role !== "manager") redirect("/login");

  const { clientId } = await params;
  const client = getClientById(clientId);
  if (!client) redirect("/gestor");

  return (
    <MonitoringCenter
      fetchUrl={`/api/gestor/monitoring?clientId=${clientId}`}
      connectionsFetchUrl={`/api/gestor/connection-metrics?clientId=${clientId}`}
    />
  );
}
