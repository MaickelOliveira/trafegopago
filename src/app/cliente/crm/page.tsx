import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { getLeads } from "@/lib/leads";
import { getFunnels, createFunnel, updateFunnel } from "@/lib/funnels";
import { getClientById } from "@/lib/clients";
import { getEmployeeById, employeeCanAccessFunnel } from "@/lib/employees";
import { ClientCrm } from "./ClientCrm";

export const dynamic = "force-dynamic";

export default async function ClienteCrmPage() {
  const session = await getSession();
  if (!session || (session.role !== "client" && session.role !== "employee")) redirect("/login");

  const clientId = session.clientId!;
  const client = getClientById(clientId);
  if (!client) redirect("/login");

  // Resolves which funnels this session can see
  let allFunnels = getFunnels().filter((f) => f.clientId === clientId);

  if (session.role === "employee" && session.employeeId) {
    const emp = getEmployeeById(session.employeeId);
    if (!emp || !emp.active) redirect("/login");
    allFunnels = allFunnels.filter((f) => employeeCanAccessFunnel(emp, f.id));
  } else if (session.role === "client") {
    // Auto-cria funil padrão se cliente ainda não tem nenhum
    if (allFunnels.length === 0) {
      const created = createFunnel("Funil Principal");
      updateFunnel(created.id, { clientId });
      allFunnels = [{ ...created, clientId }];
    }
  }

  const funnelIds = new Set(allFunnels.map((f) => f.id));
  const allLeads = getLeads(clientId).filter((l) => funnelIds.has(l.funnelId));

  // Employees can't delete leads
  const canDeleteLeads =
    session.role === "client" ||
    (session.role === "employee"
      ? (getEmployeeById(session.employeeId!)?.permissions?.canDeleteLeads ?? false)
      : false);

  return (
    <ClientCrm
      clientId={clientId}
      clientName={client.name}
      clientColor={client.color}
      initialLeads={allLeads}
      initialFunnels={allFunnels}
      canDeleteLeads={canDeleteLeads}
    />
  );
}
