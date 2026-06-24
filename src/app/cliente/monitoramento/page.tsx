import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { getClientById } from "@/lib/clients";
import { MonitoringCenter } from "@/components/shared/MonitoringCenter";

export const dynamic = "force-dynamic";

export default async function ClienteMonitoramentoPage() {
  const session = await getSession();
  if (!session || (session.role !== "client" && session.role !== "employee")) redirect("/login");
  if (session.role === "employee") {
    const { getEmployeeById } = await import("@/lib/employees");
    const emp = session.employeeId ? getEmployeeById(session.employeeId) : null;
    if (!emp || !emp.active || !emp.permissions?.canViewAgentIa) redirect("/cliente/crm");
  }

  const clientId = session.clientId!;
  const client = getClientById(clientId);
  if (!client) redirect("/login");

  return (
    <MonitoringCenter fetchUrl="/api/cliente/monitoring" connectionsFetchUrl="/api/cliente/connection-metrics" />
  );
}
