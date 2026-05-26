import { NextRequest, NextResponse } from "next/server";
import { markAsRead } from "@/lib/conversations";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const { phone } = await req.json();
  if (!phone) return NextResponse.json({ error: "phone required" }, { status: 400 });
  markAsRead(phone);
  return NextResponse.json({ ok: true });
}
