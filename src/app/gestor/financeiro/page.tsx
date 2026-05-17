import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { getClients } from "@/lib/clients";
import { FinanceiroView } from "@/components/financeiro/FinanceiroView";

export default async function FinanceiroPage() {
  const session = await getSession();
  if (!session || session.role !== "manager") redirect("/login");

  const clients = getClients().map((c) => ({ id: c.id, name: c.name, color: c.color }));

  return <FinanceiroView clients={clients} />;
}
