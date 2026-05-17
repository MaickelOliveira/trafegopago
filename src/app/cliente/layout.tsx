import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { getClientById } from "@/lib/clients";
import { ClientPortalHeader } from "@/components/cliente/ClientPortalHeader";

export default async function ClienteLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session || session.role !== "client") redirect("/login");

  const client = getClientById(session.clientId!);
  if (!client) redirect("/login");

  return (
    <div className="min-h-screen bg-slate-50">
      <ClientPortalHeader clientName={client.name} clientColor={client.color} />
      <main>{children}</main>
    </div>
  );
}
