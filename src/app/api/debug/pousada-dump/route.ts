import { NextRequest, NextResponse } from "next/server";
import { getReservas } from "@/lib/pousada";

export const dynamic = "force-dynamic";

// Dump só-leitura pra depurar dados importados/gravados — não altera nada.
export async function GET(req: NextRequest) {
  const clientId = req.nextUrl.searchParams.get("clientId");
  if (!clientId) return NextResponse.json({ error: "clientId obrigatório" }, { status: 400 });
  return NextResponse.json(getReservas(clientId));
}
