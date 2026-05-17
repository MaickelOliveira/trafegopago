import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { getClientById } from "@/lib/clients";
import { AutomacoesView } from "@/components/shared/AutomacoesView";

export default async function ClienteAutomacoesPage() {
  const session = await getSession();
  if (!session || session.role !== "client") redirect("/login");

  const client = getClientById(session.clientId!);
  if (!client) redirect("/login");

  const { passwordHash: _, ...safe } = client;

  return <AutomacoesView client={safe} role="client" />;
}
