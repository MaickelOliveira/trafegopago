import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { getClients } from "@/lib/clients";
import { GestorSidebar } from "@/components/gestor/GestorSidebar";

export default async function GestorLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session || session.role !== "manager") redirect("/login");

  const clients = (await getClients()).map(c => ({ id: c.id, name: c.name, email: c.email, color: c.color, cplTarget: c.cplTarget, adAccounts: c.adAccounts, enabledSystems: c.enabledSystems }));

  return (
    <div className="nexo-app-shell">
      <GestorSidebar clients={clients} />
      <main id="main-content" className="nexo-main">{children}</main>
    </div>
  );
}
