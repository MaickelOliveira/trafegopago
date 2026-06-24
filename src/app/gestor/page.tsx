import { getClients } from "@/lib/clients";
import { getLeads } from "@/lib/leads";
import { AttentionBoard } from "@/components/shared/AttentionBoard";
import Link from "next/link";
import Image from "next/image";

export default async function GestorHome() {
  const clients = getClients().map(({ passwordHash: _, ...c }) => c);
  const leads = getLeads();

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-slate-900">Visão Geral</h1>
        <p className="mt-1 text-sm text-slate-500">
          {clients.length} {clients.length === 1 ? "cliente" : "clientes"} cadastrados
        </p>
      </div>

      <div className="mb-8">
        <AttentionBoard initialLeads={leads} clients={clients.map((c) => ({ id: c.id, name: c.name }))} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {clients.map((client) => (
          <Link
            key={client.id}
            href={`/gestor/${client.id}`}
            className="group rounded-xl border border-slate-200 bg-white p-6 shadow-sm hover:shadow-md hover:border-slate-300 transition"
          >
            <div className="flex items-start gap-4">
              <span
                className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-lg font-bold text-white overflow-hidden"
                style={client.logoUrl ? undefined : { backgroundColor: client.color }}
              >
                {client.logoUrl ? (
                  <Image src={client.logoUrl} alt={client.name} fill className="object-cover" />
                ) : (
                  client.name.charAt(0).toUpperCase()
                )}
              </span>
              <div className="flex-1 min-w-0">
                <h2 className="font-semibold text-slate-900 group-hover:text-blue-600 transition truncate">
                  {client.name}
                </h2>
                <p className="text-sm text-slate-500 truncate">{client.email}</p>
              </div>
            </div>

            <div className="mt-4 flex items-center gap-4 text-xs text-slate-500">
              <span className="flex items-center gap-1">
                <span className="h-1.5 w-1.5 rounded-full bg-blue-500" />
                {client.adAccounts.filter((a) => a.platform === "meta").length} Meta
              </span>
              <span className="flex items-center gap-1">
                <span className="h-1.5 w-1.5 rounded-full bg-orange-500" />
                {client.adAccounts.filter((a) => a.platform === "google").length} Google
              </span>
              <span className="ml-auto text-slate-400">
                CPL alvo: R$ {client.cplTarget}
              </span>
            </div>
          </Link>
        ))}

        <Link
          href="/gestor/configuracoes"
          className="flex items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-200 bg-white p-6 text-sm text-slate-400 hover:border-blue-300 hover:text-blue-500 transition"
        >
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Adicionar cliente
        </Link>
      </div>
    </div>
  );
}
