import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getChecklistTasks, createChecklistTask } from "@/lib/checklists";

export async function GET() {
  const session = await getSession();
  if (!session || (session.role !== "client" && session.role !== "employee")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const tasks = getChecklistTasks(session.clientId!);
  return NextResponse.json({ tasks });
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || (session.role !== "client" && session.role !== "employee")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await req.json() as { title: string; dueDate?: string; owner: "gestor" | "cliente" };
  if (!body.title?.trim() || !body.owner) {
    return NextResponse.json({ error: "title e owner são obrigatórios" }, { status: 400 });
  }
  const task = createChecklistTask({
    clientId: session.clientId!,
    title: body.title.trim(),
    dueDate: body.dueDate || undefined,
    owner: body.owner,
    createdBy: "client",
  });
  return NextResponse.json(task);
}
