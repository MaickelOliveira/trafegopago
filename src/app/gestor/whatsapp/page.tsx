import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { getClients, getConfig, getAllAgentConfigs } from "@/lib/clients";
import { getFunnels } from "@/lib/funnels";
import { getWppSessions } from "@/lib/wppconnect-sessions";
import { WhatsAppManagerView } from "@/components/whatsapp/WhatsAppManagerView";

export const dynamic = "force-dynamic";

export default async function WhatsAppManagerPage() {
  const session = await getSession();
  if (!session || session.role !== "manager") redirect("/login");

  const funnels = getFunnels().map(f => ({
    id: f.id,
    name: f.name,
    clientId: f.clientId ?? null,
  }));

  // IDs de conexão atualmente existentes — usado pra marcar configs de agente
  // "órfãs" (presas a uma conexão excluída/substituída) que podem ser
  // reaproveitadas ao vincular uma instância nova.
  const liveConnectionIds = new Set<string>();
  for (const f of getFunnels()) for (const c of f.connections ?? []) liveConnectionIds.add(c.id);
  for (const s of getWppSessions()) liveConnectionIds.add(s.id);

  const clients = getClients().map(c => ({
    id: c.id,
    name: c.name,
    color: c.color,
    agentEnabled: c.agentConfig?.enabled ?? false,
    agentConnectionId: c.agentConfig?.whatsappConnectionId ?? null,
    agents: getAllAgentConfigs(c).map(a => ({
      name: a.name,
      whatsappConnectionId: a.whatsappConnectionId,
      isOrphaned: !!a.whatsappConnectionId && !liveConnectionIds.has(a.whatsappConnectionId),
    })),
  }));

  const config = getConfig();

  // Auto-detecta URL base: config > env > cabeçalho da requisição
  const headersList = await headers();
  const host = headersList.get("host") ?? "";
  const proto = headersList.get("x-forwarded-proto") ?? "https";
  const detectedBase = host ? `${proto}://${host}` : "";

  const baseUrl =
    config.appBaseUrl?.replace(/\/$/, "") ||
    process.env.APP_BASE_URL?.replace(/\/$/, "") ||
    process.env.NEXTAUTH_URL?.replace(/\/$/, "") ||
    detectedBase;

  const appWebhookUrl = `${baseUrl}/api/whatsapp/webhook`;

  return (
    <WhatsAppManagerView
      funnels={funnels}
      clients={clients}
      appWebhookUrl={appWebhookUrl}
    />
  );
}
