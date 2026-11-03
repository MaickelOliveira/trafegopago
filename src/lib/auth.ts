import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import type { NextRequest } from "next/server";

const COOKIE = "tp_session";

// Lazy — evita quebrar `next build` (que importa este módulo ao coletar dados
// de página das rotas, sem env vars de runtime disponíveis). A checagem real
// só acontece quando um token é de fato assinado/verificado.
function getSecret(): Uint8Array {
  if (!process.env.JWT_SECRET) {
    throw new Error("JWT_SECRET não está configurado — defina essa variável de ambiente antes de iniciar o servidor.");
  }
  return new TextEncoder().encode(process.env.JWT_SECRET);
}

export type JWTPayload = {
  sub: string;
  role: "manager" | "client" | "employee";
  name: string;
  clientId?: string;
  sessionVersion?: number;
  employeeId?: string;       // presente quando role === "employee"
};

export async function signToken(payload: JWTPayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(getSecret());
}

export async function verifyToken(token: string): Promise<JWTPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret(), { algorithms: ["HS256"] });
    if (typeof payload.sub !== "string" || typeof payload.name !== "string" ||
        !["manager", "client", "employee"].includes(String(payload.role))) return null;
    if (payload.role !== "manager" && (typeof payload.clientId !== "string" || !payload.clientId)) return null;
    if (payload.role === "employee" && typeof payload.employeeId !== "string") return null;
    return payload as unknown as JWTPayload;
  } catch {
    return null;
  }
}

export async function getSession(): Promise<JWTPayload | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE)?.value;
  if (!token) return null;
  return validateSession(await verifyToken(token));
}

async function validateSession(session: JWTPayload | null): Promise<JWTPayload | null> {
  if (!session) return null;
  if (session.role === "employee") {
    const { getEmployeeById } = await import("./employees");
    const employee = await getEmployeeById(session.employeeId!);
    if (!employee?.active || employee.clientId !== session.clientId || employee.id !== session.sub || (session.sessionVersion ?? 0) !== (employee.sessionVersion ?? 0)) return null;
  } else if (session.role === "client") {
    const { getClientById } = await import("./clients");
    const client = await getClientById(session.clientId!);
    if (session.sub !== session.clientId || !client || (session.sessionVersion ?? 0) !== (client.sessionVersion ?? 0)) return null;
  }
  return session;
}

export async function getRequestSession(request: NextRequest): Promise<JWTPayload | null> {
  const token = request.cookies.get(COOKIE)?.value;
  return token ? validateSession(await verifyToken(token)) : null;
}

export async function setSessionCookie(token: string) {
  const cookieStore = await cookies();
  cookieStore.set(COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 7,
    path: "/",
  });
}

export async function clearSessionCookie() {
  const cookieStore = await cookies();
  cookieStore.delete(COOKIE);
}
