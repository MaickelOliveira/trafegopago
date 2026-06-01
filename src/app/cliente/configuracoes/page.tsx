import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { getEmployeeById } from "@/lib/employees";
import { ConfiguracoesView } from "@/components/cliente/ConfiguracoesView";

export const dynamic = "force-dynamic";

export default async function ClienteConfiguracoesPage() {
  const session = await getSession();
  if (!session || session.role !== "employee" || !session.employeeId) {
    redirect("/cliente/crm");
  }

  const emp = getEmployeeById(session.employeeId);
  if (!emp || !emp.active) redirect("/login");

  return (
    <ConfiguracoesView
      employeeName={emp.name}
      currentLogoUrl={emp.logoUrl ?? null}
    />
  );
}
