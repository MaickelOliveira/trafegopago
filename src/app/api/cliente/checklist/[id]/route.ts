import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getChecklistTaskById, updateChecklistTask, deleteChecklistTask } from "@/lib/checklists";

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || (session.role !== "client" && session.role !== "employee")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const existing = getChecklistTaskById(id);
  if (!existing || existing.clientId !== session.clientId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const body = await req.json() as Partial<{ title: string; dueDate: string | null; owner: "gestor" | "cliente"; done: boolean }>;
  const task = updateChecklistTask(id, {
    ...(body.title !== undefined ? { title: body.title } : {}),
    ...(body.dueDate !== undefined ? { dueDate: body.dueDate ?? undefined } : {}),
    ...(body.owner !== undefined ? { owner: body.owner } : {}),
    ...(body.done !== undefined ? { done: body.done } : {}),
  });
  return NextResponse.json(task);
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || (session.role !== "client" && session.role !== "employee")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const existing = getChecklistTaskById(id);
  if (!existing || existing.clientId !== session.clientId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const ok = deleteChecklistTask(id);
  return NextResponse.json({ ok });
}
