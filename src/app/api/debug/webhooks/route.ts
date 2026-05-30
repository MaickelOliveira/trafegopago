import { NextResponse } from "next/server";
import { readFileSync, existsSync, writeFileSync } from "fs";
import path from "path";

export const dynamic = "force-dynamic";

export async function GET() {
  const file = path.join(process.cwd(), "data", "webhook-debug.json");
  if (!existsSync(file)) {
    return NextResponse.json({ entries: [], note: "Nenhum webhook recebido ainda." });
  }
  try {
    const raw = readFileSync(file, "utf-8");
    const data = JSON.parse(raw);
    return NextResponse.json(data);
  } catch {
    // Arquivo corrompido — retorna conteúdo bruto e reseta
    try {
      const raw = readFileSync(file, "utf-8");
      // Reseta o arquivo para evitar erro contínuo
      writeFileSync(file, JSON.stringify({ entries: [] }, null, 2));
      return NextResponse.json({ error: "Arquivo corrompido (resetado)", raw: raw.slice(0, 2000) }, { status: 200 });
    } catch {
      return NextResponse.json({ error: "Erro ao ler arquivo" }, { status: 500 });
    }
  }
}

/** DELETE — limpa o arquivo de debug */
export async function DELETE() {
  const file = path.join(process.cwd(), "data", "webhook-debug.json");
  try {
    writeFileSync(file, JSON.stringify({ entries: [] }, null, 2));
    return NextResponse.json({ ok: true, message: "Debug resetado." });
  } catch {
    return NextResponse.json({ error: "Não foi possível resetar" }, { status: 500 });
  }
}
