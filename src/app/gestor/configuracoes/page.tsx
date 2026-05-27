import { getClients, getConfig } from "@/lib/clients";
import { getFunnels } from "@/lib/funnels";
import { ConfiguracoesView } from "@/components/gestor/ConfiguracoesView";

export default async function ConfiguracoesPage() {
  const clients = getClients().map(({ passwordHash: _, ...c }) => c);
  const { appBaseUrl } = getConfig();
  const funnels = getFunnels();
  const allConnections = funnels.flatMap((f) =>
    (f.connections ?? [])
      .filter(
        (c) =>
          (c.type === "uazapi" && c.uazapiToken) ||
          (c.type === "meta" && c.metaPhoneNumberId && c.metaToken),
      )
      .map((c) => ({ id: c.id, phone: c.phone, funnelName: f.name, type: c.type as "uazapi" | "meta" }))
  );
  return <ConfiguracoesView clients={clients} appBaseUrl={appBaseUrl} allConnections={allConnections} />;
}
