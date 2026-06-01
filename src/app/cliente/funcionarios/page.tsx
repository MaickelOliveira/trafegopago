import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { getClientById } from "@/lib/clients";
import { getFunnels } from "@/lib/funnels";
import { getEmployees } from "@/lib/employees";
import { FuncionariosView } from "@/components/cliente/FuncionariosView";

export const dynamic = "force-dynamic";

export default async function FuncionariosPage() {
  const session = await getSession();
  // Somente o cliente dono pode gerenciar funcionários
  if (!session || session.role !== "client") redirect("/login");

  const clientId = session.clientId!;
  const client = getClientById(clientId);
  if (!client) redirect("/login");

  const funnels = getFunnels().filter((f) => f.clientId === clientId);
  const employees = getEmployees(clientId).map(({ passwordHash: _, ...rest }) => rest);

  return (
    <FuncionariosView
      initialEmployees={employees}
      funnels={funnels}
    />
  );
}
