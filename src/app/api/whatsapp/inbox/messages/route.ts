import { NextRequest, NextResponse } from "next/server";
import { getHistory, markAsRead } from "@/lib/conversations";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const phone = req.nextUrl.searchParams.get("phone");
  if (!phone) return NextResponse.json({ error: "phone required" }, { status: 400 });
  const clientId = req.nextUrl.searchParams.get("clientId") ?? undefined;
  const connId = req.nextUrl.searchParams.get("connId") ?? undefined;

  const messages = getHistory(phone, clientId, connId);
  markAsRead(phone, clientId, connId);

  return NextResponse.json({ messages });
}
