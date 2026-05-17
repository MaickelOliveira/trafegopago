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

  if (email.toLowerCase() === config.manager.email.toLowerCase()) {
    const valid = bcrypt.compareSync(password, config.manager.passwordHash);
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
