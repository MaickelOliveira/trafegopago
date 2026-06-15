import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { getClientById } from "@/lib/clients";
import { getFunnels } from "@/lib/funnels";
import { getTemplates } from "@/lib/waba-templates";
import { WabaView } from "@/components/waba/WabaView";

export const dynamic = "force-dynamic";

export default async function ClienteDisparosWaPage() {
  const session = await getSession();
  if (!session || (session.role !== "client" && session.role !== "employee")) redirect("/login");
  if (session.role === "employee") {
    const { getEmployeeById } = await import("@/lib/employees");
    const emp = session.employeeId ? getEmployeeById(session.employeeId) : null;
    if (!emp || !emp.active || !emp.permissions?.canViewWaba) redirect("/cliente/crm");
  }

  const clientId = session.clientId!;
  const client = getClientById(clientId);
  if (!client) redirect("/login");

  const funnels = getFunnels().filter((f) => f.clientId === clientId);
  const templates = getTemplates(clientId);

  const metaConnections = funnels.flatMap((f) =>
    (f.connections ?? [])
      .filter((c) => c.type === "meta" && c.metaPhoneNumberId && c.metaToken)
      .map((c) => ({
        id: c.id,
        phone: c.phone,
        phoneNumberId: c.metaPhoneNumberId!,
        token: c.metaToken!,
        funnelName: f.name,
      })),
  );

  return (
    <WabaView
      clientId={clientId}
      initialTemplates={templates}
      metaConnections={metaConnections}
      funnels={funnels}
    />
  );
}
