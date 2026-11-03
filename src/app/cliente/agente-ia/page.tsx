import { getFunnelForConnection } from "@/lib/lead-context";
import { getEmployeeById, employeeCanAccessFunnel } from "@/lib/employees";
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
    const emp = session.employeeId ? (await getEmployeeById(session.employeeId)) : null;
    if (!emp || !emp.active || !emp.permissions?.canViewAgentIa) redirect("/cliente/crm");
  }

  const clientId = session.clientId!;
  const client = (await getClientById(clientId));
  if (!client) redirect("/login");

  let agentConfigs = getAllAgentConfigs(client);
  if (session.role === "employee") {
    const employee = await getEmployeeById(session.employeeId!);
    const allowed = await Promise.all(agentConfigs.map(async config => { const funnel = config.whatsappConnectionId ? await getFunnelForConnection(clientId, config.whatsappConnectionId) : undefined; return !!employee && !!funnel && employeeCanAccessFunnel(employee, funnel.id); }));
    agentConfigs = agentConfigs.filter((_, index) => allowed[index]);
  }
  agentConfigs = agentConfigs.map(config => ({ enabled: config.enabled, followUpEnabled: config.followUpEnabled, followUps: config.followUps, name: config.name, whatsappConnectionId: config.whatsappConnectionId, aiResumeKeyword: config.aiResumeKeyword, mediaLibrary: config.mediaLibrary, systemPrompt: config.systemPrompt, messageWaitSeconds: config.messageWaitSeconds, maxMessageLength: config.maxMessageLength, splitMessages: config.splitMessages, googleCalendarId: config.googleCalendarId }));

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
