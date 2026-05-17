import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { getClients } from "@/lib/clients";
import { CalendarioView } from "@/components/financeiro/CalendarioView";

export default async function DespesasPage() {
  const session = await getSession();
  if (!session || session.role !== "manager") redirect("/login");
  const clients = getClients().map((c) => ({ id: c.id, name: c.name, color: c.color }));
  return <CalendarioView tipo="despesa" clients={clients} />;
}
