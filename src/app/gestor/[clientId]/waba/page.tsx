import { notFound } from "next/navigation";
import { getClientById } from "@/lib/clients";
import { getFunnels } from "@/lib/funnels";
import { getTemplates } from "@/lib/waba-templates";
import { getEvolutionSessions } from "@/lib/evolution-sessions";
import { DisparosWaView } from "@/components/waba/DisparosWaView";

type Props = { params: Promise<{ clientId: string }> };

export default async function WabaPage({ params }: Props) {
  const { clientId } = await params;
  const client = getClientById(clientId);
  if (!client) notFound();

  const funnels = getFunnels().filter((f) => f.clientId === clientId);
  const templates = getTemplates(clientId);

  // Coleta phoneNumberIds e tokens disponíveis nas conexões Meta do cliente
  const metaConnections = funnels.flatMap((f) =>
    (f.connections ?? [])
      .filter((c) => c.type === "meta" && c.metaPhoneNumberId && c.metaToken)
      .map((c) => ({
        id: c.id,
        phone: c.phone,
        phoneNumberId: c.metaPhoneNumberId!,
        token: c.metaToken!,
        funnelName: f.name,
      })),
  );

  const evolutionConnections = getEvolutionSessions().filter((s) => s.clientId === clientId);

  return (
    <DisparosWaView
      clientId={clientId}
      initialTemplates={templates}
      metaConnections={metaConnections}
      evolutionConnections={evolutionConnections}
      funnels={funnels}
    />
  );
}
