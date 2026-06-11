import { NextResponse } from "next/server";
import { readFileSync, existsSync, writeFileSync } from "fs";
import path from "path";

export const dynamic = "force-dynamic";

const FILE = path.join(process.cwd(), "data", "debug-wpp-events.json");

/** Lista os últimos eventos brutos recebidos pelo webhook do WPPConnect (qualquer sessão). */
export function GET() {
  if (!existsSync(FILE)) {
    return NextResponse.json({ message: "Nenhum evento capturado ainda.", events: [] });
  }
  try {
    const events = JSON.parse(readFileSync(FILE, "utf-8"));
    return NextResponse.json({ count: events.length, events });
  } catch {
    return NextResponse.json({ error: "Erro ao ler arquivo de debug" }, { status: 500 });
  }
}

export function DELETE() {
  try {
    writeFileSync(FILE, JSON.stringify([], null, 2));
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Erro ao limpar" }, { status: 500 });
  }
}
