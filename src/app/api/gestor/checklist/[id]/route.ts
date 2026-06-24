import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { updateChecklistTask, deleteChecklistTask } from "@/lib/checklists";

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || session.role !== "manager") {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }
  const { id } = await params;
  const body = await req.json() as Partial<{ title: string; dueDate: string | null; owner: "gestor" | "cliente"; done: boolean }>;
  const task = updateChecklistTask(id, {
    ...(body.title !== undefined ? { title: body.title } : {}),
    ...(body.dueDate !== undefined ? { dueDate: body.dueDate ?? undefined } : {}),
    ...(body.owner !== undefined ? { owner: body.owner } : {}),
    ...(body.done !== undefined ? { done: body.done } : {}),
  });
  if (!task) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(task);
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || session.role !== "manager") {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }
  const { id } = await params;
  const ok = deleteChecklistTask(id);
  return NextResponse.json({ ok });
}
