import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { getSession } from "@/lib/auth";
import {
  getEmployees,
  createEmployee,
  DEFAULT_PERMISSIONS,
  type Employee,
} from "@/lib/employees";

/** Somente o cliente dono pode gerenciar funcionários */
async function requireClient() {
  const session = await getSession();
  if (!session || session.role !== "client") return null;
  return session;
}

// GET /api/cliente/employees — lista funcionários do cliente logado
export async function GET() {
  const session = await requireClient();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const employees = (await getEmployees(session.clientId!)).map(
    ({ passwordHash: _, ...rest }) => rest
  );
  return NextResponse.json({ employees });
}

// POST /api/cliente/employees — cria novo funcionário
export async function POST(req: NextRequest) {
  const session = await requireClient();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { name, email, password, allowedFunnelIds, permissions } = body;

  if (typeof name !== "string" || !name.trim() || name.length > 200 || typeof email !== "string" || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || typeof password !== "string" || password.length < 12 || Buffer.byteLength(password) > 72) {
    return NextResponse.json({ error: "Informe nome, e-mail e senha de pelo menos 12 caracteres" }, { status: 400 });
  }

  // e-mail único globalmente
  const { getEmployeeByEmail } = await import("@/lib/employees");
  const { getClientByEmail } = await import("@/lib/clients");
  if ((await getEmployeeByEmail(email)) || (await getClientByEmail(email))) {
    return NextResponse.json({ error: "E-mail já em uso" }, { status: 409 });
  }

  const passwordHash = await bcrypt.hash(password, 12);

  const employee = (await createEmployee({
    clientId: session.clientId!,
    name: name.trim(),
    email: email.toLowerCase().trim(),
    passwordHash,
    active: true,
    allowedFunnelIds: Array.isArray(allowedFunnelIds) ? allowedFunnelIds : [],
    permissions: { ...DEFAULT_PERMISSIONS, ...(permissions ?? {}) },
  }));

  const { passwordHash: _, ...safe } = employee;
  return NextResponse.json({ employee: safe }, { status: 201 });
}
