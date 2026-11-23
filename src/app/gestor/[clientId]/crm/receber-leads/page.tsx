import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { getAgentConfigForConnection, getClientById } from "@/lib/clients";
import { getLiveConnectionsForClient } from "@/lib/connection-metrics";
import { LeadRecipientsForm } from "./LeadRecipientsForm";

export default async function ReceiveLeadsPage({ params }: { params: Promise<{ clientId: string }> }) {
  if ((await getSession())?.role !== "manager") redirect("/login");
  const { clientId } = await params;
  const client = await getClientById(clientId);
  if (!client) redirect("/gestor");

  const connections = (await getLiveConnectionsForClient(clientId)).map(connection => ({
    id: connection.id,
    type: connection.type,
    label: [connection.phone || connection.id, connection.funnelName].filter(Boolean).join(" · "),
    recipients: getAgentConfigForConnection(client, connection.id)?.leadRecipients ?? [],
  }));

  return (
    <main className="mx-auto w-full max-w-3xl space-y-5 px-4 py-6 sm:px-8">
      <Link href={`/gestor/${encodeURIComponent(clientId)}/crm`} className="text-sm font-semibold text-blue-700 hover:underline">
        ← Voltar ao CRM
      </Link>
      <div>
        <p className="text-sm text-slate-500">{client.name}</p>
        <h1 className="text-2xl font-bold text-slate-900">Receber leads</h1>
        <p className="mt-1 text-sm text-slate-600">Escolha quem recebe o aviso quando um lead é criado no CRM deste funil. A mensagem inclui os dados do contato, as respostas disponíveis e o link do WhatsApp. O envio funciona mesmo com a IA desligada.</p>
      </div>
      {connections.length ? <LeadRecipientsForm key={clientId} clientId={clientId} connections={connections} /> : (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 text-sm text-slate-600">
          <p>Conecte um WhatsApp deste cliente para adicionar destinatários.</p>
          <Link href="/gestor/whatsapp" className="mt-2 inline-block font-semibold text-blue-700 hover:underline">Conectar WhatsApp</Link>
        </div>
      )}
    </main>
  );
}
