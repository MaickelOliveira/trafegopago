import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { ChecklistBoard } from "@/components/shared/ChecklistBoard";

export const dynamic = "force-dynamic";

export default async function ClienteChecklistPage() {
  const session = await getSession();
  if (!session || (session.role !== "client" && session.role !== "employee")) redirect("/login");

  return (
    <div className="p-6">
      <div className="mb-4">
        <h1 className="text-xl font-bold text-slate-900">✅ Checklist</h1>
        <p className="text-sm text-slate-500 mt-0.5">Tarefas combinadas entre você e a agência, pra nada ficar pra trás.</p>
      </div>
      <ChecklistBoard fetchUrl="/api/cliente/checklist" apiBase="/api/cliente/checklist" clientId={session.clientId!} />
    </div>
  );
}
