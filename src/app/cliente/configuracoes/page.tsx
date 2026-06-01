import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { getClientById } from "@/lib/clients";
import { ConfiguracoesView } from "@/components/cliente/ConfiguracoesView";

export const dynamic = "force-dynamic";

export default async function ClienteConfiguracoesPage() {
  const session = await getSession();
  if (!session || session.role !== "client" || !session.clientId) {
    redirect("/cliente");
  }

  const client = getClientById(session.clientId);
  if (!client) redirect("/login");

  return (
    <ConfiguracoesView
      name={client.name}
      currentLogoUrl={client.logoUrl ?? null}
    />
  );
}
