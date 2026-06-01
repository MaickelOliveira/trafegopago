import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { signToken, setSessionCookie } from "@/lib/auth";
import { getConfig, getClientByEmail } from "@/lib/clients";
import { getEmployeeByEmail } from "@/lib/employees";

export async function POST(req: NextRequest) {
  const { email, password } = await req.json();

  if (!email || !password) {
    return NextResponse.json({ error: "Dados incompletos" }, { status: 400 });
  }

  // Env var overrides têm prioridade — funcionam mesmo sem data/config.json no volume
  const managerEmailEnv = process.env.MANAGER_EMAIL;
  const managerPasswordEnv = process.env.MANAGER_PASSWORD;

  // Se ambas as env vars estão definidas, autentica sem precisar do config.json
  if (managerEmailEnv && managerPasswordEnv) {
    if (email.toLowerCase() === managerEmailEnv.toLowerCase()) {
      if (password !== managerPasswordEnv) {
        return NextResponse.json({ error: "Credenciais inválidas" }, { status: 401 });
      }
      const token = await signToken({ sub: "manager", role: "manager", name: "Gestor" });
      await setSessionCookie(token);
      return NextResponse.json({ role: "manager", redirect: "/gestor" });
    }
  }

  let config;
  try {
    config = getConfig();
  } catch {
    return NextResponse.json({ error: "Configuração não encontrada. Defina MANAGER_EMAIL e MANAGER_PASSWORD nas variáveis de ambiente." }, { status: 500 });
  }

  const managerEmail = managerEmailEnv || config.manager.email;

  if (email.toLowerCase() === managerEmail.toLowerCase()) {
    const valid = managerPasswordEnv
      ? password === managerPasswordEnv
      : bcrypt.compareSync(password, config.manager.passwordHash);
    if (!valid) return NextResponse.json({ error: "Credenciais inválidas" }, { status: 401 });

    const token = await signToken({ sub: "manager", role: "manager", name: "Gestor" });
    await setSessionCookie(token);
    return NextResponse.json({ role: "manager", redirect: "/gestor" });
  }

  const client = getClientByEmail(email);
  if (!client) {
    // Tenta como funcionário
    const employee = getEmployeeByEmail(email);
    if (!employee) return NextResponse.json({ error: "Credenciais inválidas" }, { status: 401 });

    const validEmp = bcrypt.compareSync(password, employee.passwordHash);
    if (!validEmp) return NextResponse.json({ error: "Credenciais inválidas" }, { status: 401 });

    if (!employee.active) {
      return NextResponse.json({ error: "Acesso bloqueado. Contate seu gestor." }, { status: 403 });
    }

    const token = await signToken({
      sub: employee.id,
      role: "employee",
      name: employee.name,
      clientId: employee.clientId,
      employeeId: employee.id,
    });
    await setSessionCookie(token);
    return NextResponse.json({ role: "employee", redirect: "/cliente" });
  }

  const valid = bcrypt.compareSync(password, client.passwordHash);
  if (!valid) return NextResponse.json({ error: "Credenciais inválidas" }, { status: 401 });

  const token = await signToken({
    sub: client.id,
    role: "client",
    name: client.name,
    clientId: client.id,
  });
  await setSessionCookie(token);
  return NextResponse.json({ role: "client", redirect: "/cliente" });
}
