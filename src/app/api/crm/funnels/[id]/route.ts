import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { updateFunnel, deleteFunnel } from "@/lib/funnels";

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || session.role !== "manager") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const body = await req.json();
  const funnel = updateFunnel(id, body);
  if (!funnel) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(funnel);
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || session.role !== "manager") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const ok = deleteFunnel(id);
  if (!ok) return NextResponse.json({ error: "Não é possível deletar este funil" }, { status: 400 });
  return NextResponse.json({ ok: true });
}
