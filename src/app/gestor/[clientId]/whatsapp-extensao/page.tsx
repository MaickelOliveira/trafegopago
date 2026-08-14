import { notFound } from "next/navigation";
import { getClientById } from "@/lib/clients";
import { WhatsAppExtensionConnect } from "@/components/cliente/WhatsAppExtensionConnect";

type Props = { params: Promise<{ clientId: string }> };

export default async function GestorWhatsAppExtensaoPage({ params }: Props) {
  const { clientId } = await params;
  const client = getClientById(clientId);
  if (!client) notFound();

  return (
    <div className="p-6">
      <WhatsAppExtensionConnect clientId={clientId} />
    </div>
  );
}
