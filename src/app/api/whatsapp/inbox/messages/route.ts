import { NextRequest, NextResponse } from "next/server";
import { getHistory, markAsRead } from "@/lib/conversations";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const phone = req.nextUrl.searchParams.get("phone");
  if (!phone) return NextResponse.json({ error: "phone required" }, { status: 400 });

  const messages = getHistory(phone);
  markAsRead(phone);

  return NextResponse.json({ messages });
}
