import { notFound } from "next/navigation";
import { getClientById } from "@/lib/clients";
import { WaLinkGenerator } from "@/components/whatsapp/WaLinkGenerator";

type Props = { params: Promise<{ clientId: string }> };

export default async function WaLinksPage({ params }: Props) {
  const { clientId } = await params;
  const client = getClientById(clientId);
  if (!client) notFound();

  return (
    <WaLinkGenerator
      clientId={clientId}
      clientName={client.name}
      pixelId={(client as { pixelId?: string }).pixelId ?? ""}
    />
  );
}
