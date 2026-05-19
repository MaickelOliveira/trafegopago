import { getClients, getConfig } from "@/lib/clients";
import { ConfiguracoesView } from "@/components/gestor/ConfiguracoesView";

export default async function ConfiguracoesPage() {
  const clients = getClients().map(({ passwordHash: _, ...c }) => c);
  const { appBaseUrl } = getConfig();
  return <ConfiguracoesView clients={clients} appBaseUrl={appBaseUrl} />;
}
