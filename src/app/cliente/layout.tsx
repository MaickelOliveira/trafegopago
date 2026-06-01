import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { getClientById } from "@/lib/clients";
import { getEmployeeById, DEFAULT_PERMISSIONS } from "@/lib/employees";
import { ClientPortalHeader } from "@/components/cliente/ClientPortalHeader";

export default async function ClienteLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session || (session.role !== "client" && session.role !== "employee")) redirect("/login");

  const client = getClientById(session.clientId!);
  if (!client) redirect("/login");

  // Para funcionários, carrega as permissões atuais do banco
  const isEmployee = session.role === "employee";
  let permissions = DEFAULT_PERMISSIONS;
  let employeeLogoUrl: string | null = null;
  let employeeName: string | undefined;
  if (isEmployee && session.employeeId) {
    const emp = getEmployeeById(session.employeeId);
    if (!emp || !emp.active) redirect("/login");
    permissions = { ...DEFAULT_PERMISSIONS, ...emp.permissions };
    employeeLogoUrl = emp.logoUrl ?? null;
    employeeName = emp.name;
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <ClientPortalHeader
        clientName={client.name}
        clientColor={client.color}
        isEmployee={isEmployee}
        permissions={permissions}
        employeeLogoUrl={employeeLogoUrl}
        employeeName={employeeName}
      />
      <main>{children}</main>
    </div>
  );
}
