import { NextRequest, NextResponse } from "next/server";
import { getHistory, markAsRead } from "@/lib/conversations";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const phone = req.nextUrl.searchParams.get("phone");
  if (!phone) return NextResponse.json({ error: "phone required" }, { status: 400 });
  const clientId = req.nextUrl.searchParams.get("clientId") ?? undefined;

  const messages = getHistory(phone, clientId);
  markAsRead(phone, clientId);

  return NextResponse.json({ messages });
}
