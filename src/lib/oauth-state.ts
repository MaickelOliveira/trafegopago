import { randomBytes, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import { getSession } from "./auth";

type Provider = "google-calendar" | "google-ads" | "google-backup" | "meta";
function key() {
  if (!process.env.JWT_SECRET) throw new Error("Chave de sessão não configurada.");
  return new TextEncoder().encode(process.env.JWT_SECRET);
}
export async function createOAuthState(provider: Provider, details: { clientId?: string; connId?: string | null } = {}): Promise<string> {
  const session = await getSession();
  if (session?.role !== "manager") throw new Error("Acesso não permitido.");
  const nonce = randomBytes(32).toString("hex");
  (await cookies()).set(`tp_oauth_${provider}`, nonce, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 600 });
  return new SignJWT({ ...details, nonce, provider }).setProtectedHeader({ alg: "HS256" }).setSubject(session.sub).setAudience(`oauth:${provider}`).setIssuedAt().setExpirationTime("10m").sign(key());
}
export async function consumeOAuthState(provider: Provider, state: string | null): Promise<{ clientId?: string; connId?: string | null }> {
  const session = await getSession();
  const jar = await cookies();
  const cookie = jar.get(`tp_oauth_${provider}`)?.value;
  jar.delete(`tp_oauth_${provider}`);
  if (session?.role !== "manager" || !state || !cookie) throw new Error("Autorização expirada ou inválida.");
  const { payload } = await jwtVerify(state, key(), { algorithms: ["HS256"], audience: `oauth:${provider}` });
  if (payload.sub !== session.sub || typeof payload.nonce !== "string" || payload.nonce.length !== cookie.length || !timingSafeEqual(Buffer.from(payload.nonce), Buffer.from(cookie))) throw new Error("Autorização inválida.");
  return { clientId: typeof payload.clientId === "string" ? payload.clientId : undefined, connId: typeof payload.connId === "string" ? payload.connId : null };
}
