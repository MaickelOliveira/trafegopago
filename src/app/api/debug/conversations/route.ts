import { NextRequest, NextResponse } from "next/server";
import { readFileSync, existsSync } from "fs";
import path from "path";
import { getAllConversationsByClientId, phoneVariants } from "@/lib/conversations";

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

  // Busca por substring nas chaves brutas (pega qualquer variante que contenha
  // exatamente esses dígitos) E pelas variantes reais do número (com/sem 9º
  // dígito) — a substring sozinha não pega o caso em que o 9º dígito foi
  // inserido/removido no MEIO do número (logo após o DDD).
  const variants = digits ? phoneVariants(digits) : [];
  const matchingKeys = Object.keys(all).filter(
    (k) => digits && (k.includes(digits) || variants.some((v) => k.includes(v)))
  );
  const matches = Object.fromEntries(matchingKeys.map((k) => [k, all[k]]));

  const allConvs = clientId ? getAllConversationsByClientId(clientId) : [];
  const variantSet = new Set(variants);
  const convMatches = allConvs.filter((c) => variantSet.has(c.phone.replace(/\D/g, "")));

  return NextResponse.json({
    digits,
    totalKeys: Object.keys(all).length,
    matchingKeys,
    matches,
    convMatches,
  });
}
