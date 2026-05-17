import { getClients } from "@/lib/clients";
import { ConfiguracoesView } from "@/components/gestor/ConfiguracoesView";

export default async function ConfiguracoesPage() {
  const clients = getClients().map(({ passwordHash: _, ...c }) => c);
  return <ConfiguracoesView clients={clients} />;
}
