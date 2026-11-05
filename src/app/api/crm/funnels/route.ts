import { publicFunnel } from "@/lib/public-records";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getFunnels, createFunnel } from "@/lib/funnels";

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const clientId = session.role === "manager" ? req.nextUrl.searchParams.get("clientId") : session.clientId;
  const all = (await getFunnels());
  let result = clientId ? all.filter(f => f.clientId === clientId) : all;
  if (session.role === "employee") {
    const { getEmployeeById, employeeCanAccessFunnel } = await import("@/lib/employees");
    const employee = await getEmployeeById(session.employeeId!);
    result = employee ? result.filter(funnel => employeeCanAccessFunnel(employee, funnel.id)) : [];
  }
  return NextResponse.json(session.role === "manager" ? result : result.map(publicFunnel));
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || (session.role !== "manager" && session.role !== "client" && session.role !== "employee")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { name, columns, clientId: requestedClientId } = await req.json();
  const clientId = session.role === "manager" ? requestedClientId : session.clientId;
  if (!name) return NextResponse.json({ error: "name obrigatório" }, { status: 400 });

  // Clientes e funcionários só podem criar funis para o seu próprio clientId
  if (session.role !== "manager" && session.clientId && clientId && session.clientId !== clientId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const funnel = (await createFunnel(name, columns));
  if (clientId) {
    const { updateFunnel } = await import("@/lib/funnels");
    const updated = (await updateFunnel(funnel.id, { clientId }));
    return NextResponse.json(updated ?? funnel, { status: 201 });
  }
  return NextResponse.json(funnel, { status: 201 });
}
