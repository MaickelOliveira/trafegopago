import { NextRequest, NextResponse } from "next/server";
import { readFileSync, existsSync } from "fs";
import path from "path";

export const dynamic = "force-dynamic";

/** Debug: lista os últimos formulários de hóspedes criados (sem autenticação — só leitura de diagnóstico). */
export async function GET(req: NextRequest) {
  const clientId = req.nextUrl.searchParams.get("clientId") ?? undefined;
  const file = path.join(process.cwd(), "data", "guest-forms.json");
  let all: unknown[] = [];
  if (existsSync(file)) {
    try { all = JSON.parse(readFileSync(file, "utf-8")); } catch { /* ignore */ }
  }
  const filtered = clientId
    ? (all as { clientId?: string }[]).filter((f) => f.clientId === clientId)
    : all;
  return NextResponse.json({ count: filtered.length, forms: filtered.slice(0, 30) });
}
