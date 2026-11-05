import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { markAsRead } from "@/lib/conversations";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  const { phone, clientId, connId } = await req.json();
  if (!clientId || session.role !== "manager" && session.clientId !== clientId) return NextResponse.json({ error: "Não autorizado." }, { status: 403 });
  if (!phone) return NextResponse.json({ error: "phone required" }, { status: 400 });
  (await markAsRead(phone, clientId, connId));
  return NextResponse.json({ ok: true });
}
