import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { createBriefing, listBriefingsByClient } from "@/lib/briefings";

export const dynamic = "force-dynamic";

// POST /api/briefing — gestor cria um novo briefing para um cliente
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "manager") {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }

  const { clientId, clientName, notifyPhone, niche } = await req.json() as {
    clientId: string;
    clientName: string;
    notifyPhone: string;
    niche?: string;
  };

  if (!clientId || !clientName || !notifyPhone) {
    return NextResponse.json({ error: "clientId, clientName e notifyPhone são obrigatórios" }, { status: 400 });
  }

  const briefing = createBriefing({ clientId, clientName, notifyPhone, niche });

  // Usa headers do proxy reverso (EasyPanel) para montar a URL pública correta
  const proto = req.headers.get("x-forwarded-proto") ?? "https";
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? req.nextUrl.host;
  const url = `${proto}://${host}/briefing/${briefing.id}`;

  return NextResponse.json({ ok: true, token: briefing.id, url });
}

// GET /api/briefing?clientId=xxx — lista briefings do gestor
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "manager") {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }

  const clientId = req.nextUrl.searchParams.get("clientId");
  if (!clientId) return NextResponse.json({ error: "clientId required" }, { status: 400 });

  const briefings = listBriefingsByClient(clientId);
  return NextResponse.json({ briefings });
}
