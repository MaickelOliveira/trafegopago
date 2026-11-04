import { getFunnels } from "@/lib/funnels";
import { notFound } from "next/navigation";
import { getClientById, getConfig } from "@/lib/clients";
import { ClientSettingsView } from "@/components/gestor/ClientSettingsView";
export default async function ClientSettingsPage({ params, searchParams }: { params: Promise<{ clientId: string }>; searchParams: Promise<{ secao?: string }> }) {
  const { clientId } = await params; const client = await getClientById(clientId); if (!client) notFound();
  const config = await getConfig();
  const section = (await searchParams).secao;
  const funnels = (await getFunnels()).filter(funnel => funnel.clientId === clientId).map(funnel => ({ id: funnel.id, name: funnel.name }));
  const { id, name, email, color, cplTarget, funnelType, trackingFunnelId, adAccounts, enabledSystems, pixelId, googleAdsId, googleConvLabel, metaPageId, capiTestEventCode } = client;
  return <ClientSettingsView initialSection={section === "pixel" ? "rastreamento" : section} agencyCapiAvailable={!!config.metaToken} funnels={funnels} client={{ id, name, email, color, cplTarget, funnelType, trackingFunnelId, adAccounts, enabledSystems, pixelId, googleAdsId, googleConvLabel, metaPageId, capiTestEventCode, hasCapiToken: !!client.capiToken }} />;
}
