import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { ChecklistBoard } from "@/components/shared/ChecklistBoard";

export const dynamic = "force-dynamic";

export default async function GestorChecklistOverviewPage() {
  const session = await getSession();
  if (!session || session.role !== "manager") redirect("/login");

  return (
    <div className="p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">✅ Checklist</h1>
        <p className="text-sm text-slate-500 mt-0.5">Tarefas de todos os clientes, separadas por quem é responsável.</p>
      </div>
      <ChecklistBoard fetchUrl="/api/gestor/checklist" apiBase="/api/gestor/checklist" mode="all-clients" />
    </div>
  );
}
