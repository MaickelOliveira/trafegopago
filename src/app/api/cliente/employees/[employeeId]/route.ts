import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { getSession } from "@/lib/auth";
import { getEmployeeById, updateEmployee, deleteEmployee } from "@/lib/employees";

async function requireClientOwner(employeeId: string) {
  const session = await getSession();
  if (!session || session.role !== "client") return null;
  const employee = getEmployeeById(employeeId);
  if (!employee || employee.clientId !== session.clientId) return null;
  return { session, employee };
}

// PATCH /api/cliente/employees/[employeeId] — atualiza funcionário (bloqueia, permissões, funis, senha)
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ employeeId: string }> }
) {
  const { employeeId } = await params;
  const ctx = await requireClientOwner(employeeId);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const patch: Parameters<typeof updateEmployee>[1] = {};

  if (typeof body.active === "boolean") patch.active = body.active;
  if (typeof body.name === "string" && body.name.trim()) patch.name = body.name.trim();
  if (Array.isArray(body.allowedFunnelIds)) patch.allowedFunnelIds = body.allowedFunnelIds;
  if (body.permissions && typeof body.permissions === "object") {
    patch.permissions = { ...ctx.employee.permissions, ...body.permissions };
  }
  if (typeof body.password === "string" && body.password.length >= 6) {
    patch.passwordHash = bcrypt.hashSync(body.password, 10);
  }

  const updated = updateEmployee(employeeId, patch);
  if (!updated) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { passwordHash: _, ...safe } = updated;
  return NextResponse.json({ employee: safe });
}

// DELETE /api/cliente/employees/[employeeId] — remove funcionário
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ employeeId: string }> }
) {
  const { employeeId } = await params;
  const ctx = await requireClientOwner(employeeId);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const ok = deleteEmployee(employeeId);
  if (!ok) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
