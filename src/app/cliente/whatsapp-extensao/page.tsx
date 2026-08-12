import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { getFunnels } from "@/lib/funnels";
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

  const clientId = session.clientId!;
  const funnels = getFunnels()
    .filter((f) => f.clientId === clientId)
    .map((f) => ({ id: f.id, name: f.name }));

  return (
    <div className="p-6">
      <WhatsAppExtensionConnect funnels={funnels} />
    </div>
  );
}
