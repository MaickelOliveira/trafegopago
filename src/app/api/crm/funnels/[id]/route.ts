import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getFunnelById, updateFunnel, deleteFunnel } from "@/lib/funnels";

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || (session.role !== "manager" && session.role !== "client" && session.role !== "employee")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;

  // Clientes e funcionários só podem editar funis do seu próprio cliente
  if (session.role !== "manager") {
    const existing = getFunnelById(id);
    if (!existing || existing.clientId !== session.clientId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const body = await req.json();
  const funnel = updateFunnel(id, body);
  if (!funnel) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(funnel);
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || (session.role !== "manager" && session.role !== "client")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;

  // Clientes só podem deletar funis do seu próprio cliente
  if (session.role !== "manager") {
    const existing = getFunnelById(id);
    if (!existing || existing.clientId !== session.clientId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const ok = deleteFunnel(id);
  if (!ok) return NextResponse.json({ error: "Não é possível deletar este funil" }, { status: 400 });
  return NextResponse.json({ ok: true });
}
