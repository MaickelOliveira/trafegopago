import { NextResponse } from "next/server";
import { readFileSync, existsSync } from "fs";
import path from "path";

export const dynamic = "force-dynamic";

export async function GET() {
  const file = path.join(process.cwd(), "data", "webhook-debug.json");
  if (!existsSync(file)) {
    return NextResponse.json({ entries: [], note: "Nenhum webhook recebido ainda." });
  }
  try {
    const data = JSON.parse(readFileSync(file, "utf-8"));
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ error: "Erro ao ler arquivo" }, { status: 500 });
  }
}
