import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";

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
    const { payload } = await jwtVerify(token, getSecret());
    return payload as unknown as JWTPayload;
  } catch {
    return null;
  }
}

export async function getSession(): Promise<JWTPayload | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE)?.value;
  if (!token) return null;
  return verifyToken(token);
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
