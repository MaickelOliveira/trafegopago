import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getFunnels, createFunnel } from "@/lib/funnels";

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const clientId = req.nextUrl.searchParams.get("clientId");
  const all = getFunnels();
  const result = clientId ? all.filter(f => f.clientId === clientId) : all;
  return NextResponse.json(result);
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || (session.role !== "manager" && session.role !== "client" && session.role !== "employee")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { name, columns, clientId } = await req.json();
  if (!name) return NextResponse.json({ error: "name obrigatório" }, { status: 400 });

  // Clientes e funcionários só podem criar funis para o seu próprio clientId
  if (session.role !== "manager" && session.clientId && clientId && session.clientId !== clientId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const funnel = createFunnel(name, columns);
  if (clientId) {
    const { updateFunnel } = await import("@/lib/funnels");
    const updated = updateFunnel(funnel.id, { clientId });
    return NextResponse.json(updated ?? funnel, { status: 201 });
  }
  return NextResponse.json(funnel, { status: 201 });
}
