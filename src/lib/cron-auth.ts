import { timingSafeEqual, createHash } from "node:crypto";
import type { NextRequest } from "next/server";
import { getConfig } from "./clients";

export async function authorizeCron(request: NextRequest): Promise<boolean> {
  const expected = process.env.CRON_SECRET || (await getConfig()).agentCronSecret;
  const supplied = request.headers.get("x-cron-secret") || request.headers.get("authorization")?.replace(/^Bearer /, "") || request.nextUrl.searchParams.get("secret");
  if (!expected || !supplied) return false;
  const hash = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(hash(expected), hash(supplied));
}
