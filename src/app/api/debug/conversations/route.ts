import { NextRequest, NextResponse } from "next/server";
import { readFileSync, existsSync } from "fs";
import path from "path";
import { getAllConversationsByClientId } from "@/lib/conversations";

export const dynamic = "force-dynamic";

/** Debug: inspeciona conversations.json para um telefone específico. */
export async function GET(req: NextRequest) {
  const phone = req.nextUrl.searchParams.get("phone") ?? "";
  const clientId = req.nextUrl.searchParams.get("clientId") ?? undefined;
  const digits = phone.replace(/\D/g, "");

  const file = path.join(process.cwd(), "data", "conversations.json");
  let all: Record<string, unknown> = {};
  if (existsSync(file)) {
    try { all = JSON.parse(readFileSync(file, "utf-8")); } catch { /* ignore */ }
  }

  const matchingKeys = Object.keys(all).filter((k) => digits && k.includes(digits));
  const matches = Object.fromEntries(matchingKeys.map((k) => [k, all[k]]));

  const allConvs = clientId ? getAllConversationsByClientId(clientId) : [];
  const convMatches = allConvs.filter((c) => {
    const d = c.phone.replace(/\D/g, "");
    return d === digits || d.endsWith(digits.slice(-9)) || digits.endsWith(d.slice(-9));
  });

  return NextResponse.json({
    digits,
    totalKeys: Object.keys(all).length,
    matchingKeys,
    matches,
    convMatches,
  });
}
