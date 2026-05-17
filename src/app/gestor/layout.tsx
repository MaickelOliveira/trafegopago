import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { getClients } from "@/lib/clients";
import { GestorSidebar } from "@/components/gestor/GestorSidebar";

export default async function GestorLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session || session.role !== "manager") redirect("/login");

  const clients = getClients().map(({ passwordHash: _, ...c }) => c);

  return (
    <div className="flex min-h-screen bg-slate-50">
      <GestorSidebar clients={clients} />
      <main className="flex-1 min-w-0 overflow-auto">{children}</main>
    </div>
  );
}
