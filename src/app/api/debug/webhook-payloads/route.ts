import { NextResponse } from "next/server";
import { readFileSync, existsSync } from "fs";
import path from "path";

export const dynamic = "force-dynamic";

const FILE = path.join(process.cwd(), "data", "debug-webhook-payloads.json");

export function GET() {
  if (!existsSync(FILE)) {
    return NextResponse.json({ message: "Nenhum payload capturado ainda. Entre pelo anúncio e atualize esta página.", payloads: [] });
  }
  try {
    const raw = readFileSync(FILE, "utf-8");
    const payloads = JSON.parse(raw);
    return NextResponse.json({ count: payloads.length, payloads });
  } catch {
    return NextResponse.json({ error: "Erro ao ler arquivo de debug" }, { status: 500 });
  }
}
