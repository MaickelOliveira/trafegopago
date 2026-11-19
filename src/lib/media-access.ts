import { createHmac, timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import { getRequestSession } from "./auth";
import { readDocument, writeDocument, withDataTransaction } from "./document-store";
import { getClientById, getConfig, getAllAgentConfigs } from "./clients";
import { getAllConversationsByClientId, getHistory } from "./conversations";
import { getFunnelForConnection } from "./lead-context";
import { getEmployeeById, employeeCanAccessFunnel } from "./employees";

type MediaOwner = { clientId: string | null; connId?: string; createdAt: string };
function signature(pathname: string, expires: string): string {
  if (!process.env.JWT_SECRET) throw new Error("Chave de assinatura indisponível.");
  return createHmac("sha256", process.env.JWT_SECRET).update(`media:${pathname}:${expires}`).digest("hex");
}
export async function registerMediaFile(pathname: string, clientId: string | null, connId?: string): Promise<void> {
  await withDataTransaction(async () => {
    const owners = await readDocument<Record<string, MediaOwner>>("media-files.json", {});
    owners[pathname] = { clientId, connId, createdAt: new Date().toISOString() };
    await writeDocument("media-files.json", owners);
  });
}
export async function signMediaUrl(value: string): Promise<string> {
  const base = process.env.APP_BASE_URL || (await getConfig()).appBaseUrl;
  if (!base) return value;
  const url = new URL(value, base);
  if (url.origin !== new URL(base).origin || !/^\/api\/(?:media|uploads)\/[^/]+$/.test(url.pathname)) return value;
  const expires = String(Math.floor(Date.now() / 1000) + 3600);
  url.searchParams.set("expires", expires);
  url.searchParams.set("signature", signature(url.pathname, expires));
  return url.toString();
}
export async function canReadMedia(request: NextRequest): Promise<boolean> {
  const pathname = request.nextUrl.pathname;
  const expires = request.nextUrl.searchParams.get("expires");
  const supplied = request.nextUrl.searchParams.get("signature");
  if (expires && supplied && /^\d+$/.test(expires) && /^[a-f0-9]{64}$/.test(supplied)) {
    const now = Math.floor(Date.now() / 1000);
    if (Number(expires) >= now && Number(expires) <= now + 3600 && timingSafeEqual(Buffer.from(supplied, "hex"), Buffer.from(signature(pathname, expires), "hex"))) return true;
  }
  const session = await getRequestSession(request);
  if (!session) return false;
  if (session.role === "manager") return true;
  const employee = session.role === "employee" ? await getEmployeeById(session.employeeId!) : undefined;
  const allowedConnection = async (id?: string | null) => {
    if (!employee) return true;
    if (!id) return false;
    const funnel = await getFunnelForConnection(session.clientId!, id);
    return !!funnel && employeeCanAccessFunnel(employee, funnel.id);
  };
  const owner = (await readDocument<Record<string, MediaOwner>>("media-files.json", {}))[pathname];
  if (owner?.clientId && owner.clientId !== session.clientId) return false;
  if (owner?.clientId && (!employee || owner.connId)) return await allowedConnection(owner.connId);
  // Match pre-migration files to an actual reference in this account. Never
  // infer ownership from a telephone encoded in an old filename.
  const client = await getClientById(session.clientId!);
  if (client) for (const config of getAllAgentConfigs(client)) {
    if (await allowedConnection(config.whatsappConnectionId) && config.mediaLibrary?.some(media => { try { return new URL(media.url, request.nextUrl.origin).pathname === pathname; } catch { return false; } })) return true;
  }
  for (const conversation of await getAllConversationsByClientId(session.clientId!)) {
    if (!await allowedConnection(conversation.connId)) continue;
    if ((await getHistory(conversation.phone, session.clientId, conversation.connId)).some(message => { try { return !!message.mediaUrl && new URL(message.mediaUrl, request.nextUrl.origin).pathname === pathname; } catch { return false; } })) return true;
  }
  return false;
}
