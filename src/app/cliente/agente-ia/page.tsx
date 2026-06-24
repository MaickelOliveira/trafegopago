import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { getClientById, getAllAgentConfigs } from "@/lib/clients";
import { ClientAgenteIa } from "@/components/cliente/ClientAgenteIa";

export const dynamic = "force-dynamic";

export default async function ClienteAgenteIaPage() {
  const session = await getSession();
  // Funcionários sem canViewAgentIa são redirecionados ao CRM
  if (!session || (session.role !== "client" && session.role !== "employee")) redirect("/login");
  if (session.role === "employee") {
    const { getEmployeeById } = await import("@/lib/employees");
    const emp = session.employeeId ? getEmployeeById(session.employeeId) : null;
    if (!emp || !emp.active || !emp.permissions?.canViewAgentIa) redirect("/cliente/crm");
  }

  const clientId = session.clientId!;
  const client = getClientById(clientId);
  if (!client) redirect("/login");

  const agentConfigs = getAllAgentConfigs(client);

  return (
    <div>
      <div className="px-6 py-4 border-b border-slate-200 bg-white">
        <h1 className="text-xl font-semibold text-slate-800">🤖 Agente de IA</h1>
        <p className="text-sm text-slate-500 mt-0.5">Gerencie a conexão WhatsApp e veja como sua IA está configurada.</p>
      </div>
      <ClientAgenteIa agentConfigs={agentConfigs} clientName={client.name} />
    </div>
  );
}
