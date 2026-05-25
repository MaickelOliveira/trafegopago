import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getClientById } from "@/lib/clients";
import { listCalendars } from "@/lib/google-calendar";

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "manager") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const clientId = req.nextUrl.searchParams.get("clientId");
  if (!clientId) return NextResponse.json({ error: "clientId required" }, { status: 400 });

  const client = getClientById(clientId);
  const refreshToken = client?.agentConfig?.googleRefreshToken;
  if (!refreshToken) {
    return NextResponse.json({ error: "Google Calendar não conectado" }, { status: 400 });
  }

  try {
    const calendars = await listCalendars(refreshToken);
    return NextResponse.json({ calendars });
  } catch (e) {
    console.error("[calendars] error:", e);
    return NextResponse.json({ error: "Erro ao listar agendas" }, { status: 500 });
  }
}
