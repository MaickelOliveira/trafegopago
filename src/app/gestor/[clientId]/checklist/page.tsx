import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { getClientById } from "@/lib/clients";
import { ChecklistBoard } from "@/components/shared/ChecklistBoard";

export default async function GestorChecklistPage({ params }: { params: Promise<{ clientId: string }> }) {
  const session = await getSession();
  if (!session || session.role !== "manager") redirect("/login");

  const { clientId } = await params;
  const client = getClientById(clientId);
  if (!client) redirect("/gestor");

  return (
    <div className="p-6">
      <div className="mb-4">
        <h1 className="text-xl font-bold text-slate-900">✅ Checklist — {client.name}</h1>
        <p className="text-sm text-slate-500 mt-0.5">Tarefas combinadas com o cliente, pra nada ficar pra trás.</p>
      </div>
      <ChecklistBoard
        fetchUrl={`/api/gestor/checklist?clientId=${clientId}`}
        apiBase="/api/gestor/checklist"
        clientId={clientId}
      />
    </div>
  );
}
