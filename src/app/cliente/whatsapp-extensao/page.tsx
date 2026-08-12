import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { WhatsAppExtensionConnect } from "@/components/cliente/WhatsAppExtensionConnect";

export const dynamic = "force-dynamic";

export default async function ClienteWhatsAppExtensaoPage() {
  const session = await getSession();
  if (!session || (session.role !== "client" && session.role !== "employee") || !session.clientId) {
    redirect("/login");
  }
  if (session.role === "employee") {
    const { getEmployeeById } = await import("@/lib/employees");
    const emp = session.employeeId ? getEmployeeById(session.employeeId) : null;
    if (!emp || !emp.active || !emp.permissions?.canManageQR) redirect("/cliente/crm");
  }

  return (
    <div className="p-6">
      <WhatsAppExtensionConnect />
    </div>
  );
}
