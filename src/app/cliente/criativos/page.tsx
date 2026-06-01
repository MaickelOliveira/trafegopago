import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { getClientById } from "@/lib/clients";
import { CriativosView } from "@/components/shared/CriativosView";

export default async function ClienteCriativosPage() {
  const session = await getSession();
  if (!session || (session.role !== "client" && session.role !== "employee")) redirect("/login");
  if (session.role === "employee") {
    const { getEmployeeById } = await import("@/lib/employees");
    const emp = session.employeeId ? getEmployeeById(session.employeeId) : null;
    if (!emp || !emp.active || !emp.permissions?.canViewCreatives) redirect("/cliente/crm");
  }

  const client = getClientById(session.clientId!);
  if (!client) redirect("/login");

  const adAccountId = client.adAccounts[0]?.id || "";

  return (
    <CriativosView
      clientId={client.id}
      clientName={client.name}
      clientColor={client.color}
      adAccountId={adAccountId}
      role="client"
    />
  );
}
