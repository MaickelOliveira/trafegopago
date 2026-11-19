import { getEvolutionSessions } from "@/lib/evolution-sessions";
import { getClients, getAllAgentConfigs } from "@/lib/clients";
import { getFunnels } from "@/lib/funnels";
import { ClientsHub } from "@/components/gestor/ClientsHub";
export default async function ClientsPage() {
  const [clients, funnels] = await Promise.all([getClients(), getFunnels()]);
  const sessions = await getEvolutionSessions();
  return <ClientsHub clients={clients.map(client => ({ id: client.id, name: client.name, email: client.email, color: client.color, logoUrl: client.logoUrl, adAccounts: client.adAccounts, enabledSystems: client.enabledSystems,
    funnelCount: funnels.filter(funnel => funnel.clientId === client.id).length,
    channelCount: new Set(funnels.filter(funnel => funnel.clientId === client.id).flatMap(funnel => [...(funnel.connections ?? []).map(connection => connection.id), ...sessions.filter(session => session.funnelId === funnel.id).map(session => session.id)])).size,
    activeAgents: getAllAgentConfigs(client).filter(agent => agent.enabled).length,
  }))} />;
}
