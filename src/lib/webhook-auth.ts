import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
function equal(a: string, b: string): boolean { return timingSafeEqual(createHash("sha256").update(a).digest(), createHash("sha256").update(b).digest()); }
function webhookSignature(path: string): string {
  if (!process.env.JWT_SECRET) throw Error("Chave de webhook indisponível.");
  return createHmac("sha256", process.env.JWT_SECRET).update(`webhook:${path}`).digest("hex");
}
export function signWebhookUrl(value: string): string {
  const url = new URL(value);
  if (!/^\/api\/whatsapp\/webhook(?:\/[^/]+){0,2}$/.test(url.pathname)) throw Error("Caminho de webhook inválido.");
  url.searchParams.set("signature", webhookSignature(url.pathname));
  return url.toString();
}
export function authorizeWhatsAppWebhook(request: NextRequest): boolean {
  const supplied = request.headers.get("x-tp-webhook-signature") || request.nextUrl.searchParams.get("signature");
  return !!supplied && /^[a-f0-9]{64}$/.test(supplied) && equal(supplied, webhookSignature(request.nextUrl.pathname));
}
export function verifyMetaSignature(raw: string, supplied: string | null, appSecret: string | undefined): boolean {
  if (!appSecret || !supplied || !/^sha256=[a-f0-9]{64}$/.test(supplied)) return false;
  return equal(supplied, `sha256=${createHmac("sha256", appSecret).update(raw).digest("hex")}`);
}
