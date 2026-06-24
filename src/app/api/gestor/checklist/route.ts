import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getClients } from "@/lib/clients";
import { getChecklistTasks, getAllChecklistTasks, createChecklistTask } from "@/lib/checklists";

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "manager") {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }

  const clientId = req.nextUrl.searchParams.get("clientId");
  if (clientId) {
    return NextResponse.json({ tasks: getChecklistTasks(clientId) });
  }

  // Visão geral: todas as tarefas, agrupadas por cliente
  const clients = getClients();
  const allTasks = getAllChecklistTasks();
  const groups = clients
    .map((c) => ({
      clientId: c.id,
      clientName: c.name,
      tasks: allTasks.filter((t) => t.clientId === c.id),
    }))
    .filter((g) => g.tasks.length > 0);

  return NextResponse.json({ clients: groups });
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "manager") {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }

  const body = await req.json() as { clientId: string; title: string; dueDate?: string; owner: "gestor" | "cliente" };
  if (!body.clientId || !body.title?.trim() || !body.owner) {
    return NextResponse.json({ error: "clientId, title e owner são obrigatórios" }, { status: 400 });
  }

  const task = createChecklistTask({
    clientId: body.clientId,
    title: body.title.trim(),
    dueDate: body.dueDate || undefined,
    owner: body.owner,
    createdBy: "manager",
  });
  return NextResponse.json(task);
}
