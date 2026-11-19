import { publicFunnel, publicTemplate } from "@/lib/public-records";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { getLeads, attachLeadsHeat } from "@/lib/leads";
import { getFunnels, createFunnel, updateFunnel } from "@/lib/funnels";
import { getClientById } from "@/lib/clients";
import { getEmployeeById, employeeCanAccessFunnel } from "@/lib/employees";
import { ClientCrm } from "./ClientCrm";

export const dynamic = "force-dynamic";

export default async function ClienteCrmPage() {
  const session = await getSession();
  if (!session || (session.role !== "client" && session.role !== "employee")) redirect("/login");

  const clientId = session.clientId!;
  const client = (await getClientById(clientId));
  if (!client) redirect("/login");

  // Resolves which funnels this session can see
  let allFunnels = (await getFunnels()).filter((f) => f.clientId === clientId);

  if (session.role === "employee" && session.employeeId) {
    const emp = (await getEmployeeById(session.employeeId));
    if (!emp || !emp.active) redirect("/login");
    allFunnels = allFunnels.filter((f) => employeeCanAccessFunnel(emp, f.id));
  } else if (session.role === "client") {
    // Auto-cria funil padrão se cliente ainda não tem nenhum
    if (allFunnels.length === 0) {
      const created = (await createFunnel("Funil Principal"));
      (await updateFunnel(created.id, { clientId }));
      allFunnels = [{ ...created, clientId }];
    }
  }

  const funnelIds = new Set(allFunnels.map((f) => f.id));
  const allLeads = (await attachLeadsHeat((await getLeads(clientId)).filter((l) => funnelIds.has(l.funnelId))));

  // Employees can't delete leads
  const canDeleteLeads =
    session.role === "client" ||
    (session.role === "employee"
      ? ((await getEmployeeById(session.employeeId!))?.permissions?.canDeleteLeads ?? false)
      : false);

  return (
    <ClientCrm
      clientId={clientId}
      clientName={client.name}
      clientColor={client.color}
      initialLeads={allLeads}
      initialFunnels={allFunnels.map(publicFunnel)}
      canDeleteLeads={canDeleteLeads}
    />
  );
}
