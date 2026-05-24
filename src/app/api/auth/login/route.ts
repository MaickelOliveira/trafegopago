import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { signToken, setSessionCookie } from "@/lib/auth";
import { getConfig, getClientByEmail } from "@/lib/clients";

export async function POST(req: NextRequest) {
  const { email, password } = await req.json();

  if (!email || !password) {
    return NextResponse.json({ error: "Dados incompletos" }, { status: 400 });
  }

  const config = getConfig();

  // Env var overrides — úteis para redefinir senha no EasyPanel sem editar volume
  const managerEmail = process.env.MANAGER_EMAIL || config.manager.email;
  const managerPasswordOverride = process.env.MANAGER_PASSWORD; // senha em texto puro (override)

  if (email.toLowerCase() === managerEmail.toLowerCase()) {
    const valid = managerPasswordOverride
      ? password === managerPasswordOverride
      : bcrypt.compareSync(password, config.manager.passwordHash);
    if (!valid) return NextResponse.json({ error: "Credenciais inválidas" }, { status: 401 });

    const token = await signToken({ sub: "manager", role: "manager", name: "Gestor" });
    await setSessionCookie(token);
    return NextResponse.json({ role: "manager", redirect: "/gestor" });
  }

  const client = getClientByEmail(email);
  if (!client) return NextResponse.json({ error: "Credenciais inválidas" }, { status: 401 });

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
