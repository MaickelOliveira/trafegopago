import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { signToken, setSessionCookie } from "@/lib/auth";
import { getConfig, getClientByEmail } from "@/lib/clients";
import { getEmployeeByEmail } from "@/lib/employees";
import { allowLoginAttempt } from "@/lib/auth-rate-limit";
import { createHash, timingSafeEqual } from "node:crypto";

function sameSecret(left: string, right: string): boolean {
  return timingSafeEqual(createHash("sha256").update(left).digest(), createHash("sha256").update(right).digest());
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body?.password === "string" ? body.password : "";

  if (!email || !password || email.length > 254 || Buffer.byteLength(password) > 72) {
    return NextResponse.json({ error: "Dados incompletos" }, { status: 400 });
  }
  if (!await allowLoginAttempt(email)) {
    return NextResponse.json({ error: "Muitas tentativas. Aguarde alguns minutos." }, { status: 429, headers: { "Retry-After": "900" } });
  }

  // Env var overrides têm prioridade — funcionam mesmo sem data/config.json no volume
  const managerEmailEnv = process.env.MANAGER_EMAIL;
  const managerPasswordEnv = process.env.MANAGER_PASSWORD;

  // Se ambas as env vars estão definidas, autentica sem precisar do config.json
  if (managerEmailEnv && managerPasswordEnv) {
    if (email.toLowerCase() === managerEmailEnv.toLowerCase()) {
      if (!sameSecret(password, managerPasswordEnv)) {
        return NextResponse.json({ error: "Credenciais inválidas" }, { status: 401 });
      }
      const token = await signToken({ sub: "manager", role: "manager", name: "Gestor" });
      await setSessionCookie(token);
      return NextResponse.json({ role: "manager", redirect: "/gestor" });
    }
  }

  let config;
  try {
    config = (await getConfig());
  } catch {
    return NextResponse.json({ error: "Configuração não encontrada. Defina MANAGER_EMAIL e MANAGER_PASSWORD nas variáveis de ambiente." }, { status: 500 });
  }

  const managerEmail = managerEmailEnv || config.manager.email;

  if (email.toLowerCase() === managerEmail.toLowerCase()) {
    const valid = managerPasswordEnv
      ? sameSecret(password, managerPasswordEnv)
      : await bcrypt.compare(password, config.manager.passwordHash);
    if (!valid) return NextResponse.json({ error: "Credenciais inválidas" }, { status: 401 });

    const token = await signToken({ sub: "manager", role: "manager", name: "Gestor" });
    await setSessionCookie(token);
    return NextResponse.json({ role: "manager", redirect: "/gestor" });
  }

  const client = (await getClientByEmail(email));
  if (!client) {
    // Tenta como funcionário
    const employee = (await getEmployeeByEmail(email));
    if (!employee) return NextResponse.json({ error: "Credenciais inválidas" }, { status: 401 });

    const validEmp = await bcrypt.compare(password, employee.passwordHash);
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
      sessionVersion: employee.sessionVersion ?? 0,
    });
    await setSessionCookie(token);
    return NextResponse.json({ role: "employee", redirect: "/cliente" });
  }

  const valid = await bcrypt.compare(password, client.passwordHash);
  if (!valid) return NextResponse.json({ error: "Credenciais inválidas" }, { status: 401 });

  const token = await signToken({
    sub: client.id,
    role: "client",
    name: client.name,
    clientId: client.id,
    sessionVersion: client.sessionVersion ?? 0,
  });
  await setSessionCookie(token);
  return NextResponse.json({ role: "client", redirect: "/cliente" });
}
