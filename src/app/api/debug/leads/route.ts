import { NextRequest, NextResponse } from "next/server";
import { readFileSync, existsSync } from "fs";
import path from "path";

export const dynamic = "force-dynamic";

/** Debug: inspeciona leads.json para um telefone específico (busca por substring nos dígitos). */
export async function GET(req: NextRequest) {
  const phone = req.nextUrl.searchParams.get("phone") ?? "";
  const clientId = req.nextUrl.searchParams.get("clientId") ?? undefined;
  const digits = phone.replace(/\D/g, "");

  const file = path.join(process.cwd(), "data", "leads.json");
  let all: Record<string, unknown>[] = [];
  if (existsSync(file)) {
    try { all = JSON.parse(readFileSync(file, "utf-8")); } catch { /* ignore */ }
  }

  const matches = all.filter((l) => {
    if (clientId && l.clientId !== clientId) return false;
    const p = String(l.phone ?? "").replace(/\D/g, "");
    const rp = String(l.realPhone ?? "").replace(/\D/g, "");
    if (!digits) return true;
    return (p && (p.includes(digits) || digits.includes(p))) || (rp && (rp.includes(digits) || digits.includes(rp)));
  });

  return NextResponse.json({
    digits,
    totalLeads: all.length,
    matchCount: matches.length,
    matches,
  });
}
