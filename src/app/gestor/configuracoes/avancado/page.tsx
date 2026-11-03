import { getConfig } from "@/lib/clients";
import { getFunnels } from "@/lib/funnels";
import { safePlatformConfig } from "@/lib/platform-settings";
import { IntegrationSettingsView } from "@/components/gestor/IntegrationSettingsView";
export default async function IntegrationSettingsPage() {
  const [config, funnels] = await Promise.all([getConfig(), getFunnels()]);
  const connections = funnels.flatMap(funnel => (funnel.connections ?? []).map(connection => ({ id: connection.id, phone: connection.phone || "Sem número", funnelName: funnel.name })));
  return <IntegrationSettingsView initial={safePlatformConfig(config)} connections={connections} />;
}
