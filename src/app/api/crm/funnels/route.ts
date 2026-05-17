import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getFunnels, createFunnel } from "@/lib/funnels";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json(getFunnels());
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "manager") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { name, columns, clientId } = await req.json();
  if (!name) return NextResponse.json({ error: "name obrigatório" }, { status: 400 });
  const funnel = createFunnel(name, columns);
  if (clientId) {
    const { updateFunnel } = await import("@/lib/funnels");
    const updated = updateFunnel(funnel.id, { clientId });
    return NextResponse.json(updated ?? funnel, { status: 201 });
  }
  return NextResponse.json(funnel, { status: 201 });
}
