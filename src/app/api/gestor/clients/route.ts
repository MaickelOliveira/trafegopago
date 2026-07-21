import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getClients, upsertClient } from "@/lib/clients";
import bcrypt from "bcryptjs";

export async function GET() {
  const session = await getSession();
  if (!session || session.role !== "manager") {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }
  const clients = getClients().map(({ passwordHash: _, ...c }) => c);
  return NextResponse.json(clients);
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "manager") {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }

  const body = await req.json();
  const { name, email, password, color, cplTarget, funnelType, adAccounts, enabledSystems } = body;

  if (!name || !email || !password) {
    return NextResponse.json({ error: "Campos obrigatórios: name, email, password" }, { status: 400 });
  }

  const id = name.toLowerCase().replace(/[^a-z0-9]/g, "-").replace(/-+/g, "-");
  const passwordHash = bcrypt.hashSync(password, 10);

  upsertClient({
    id,
    name,
    email,
    passwordHash,
    color: color || "#6366F1",
    cplTarget: cplTarget || 25,
    funnelType: funnelType || "leads",
    adAccounts: adAccounts || [],
    enabledSystems: enabledSystems || [],
  });

  return NextResponse.json({ ok: true, id });
}
