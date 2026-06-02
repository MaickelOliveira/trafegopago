import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getQuickReplies, createQuickReply } from "@/lib/quick-replies";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const clientId = req.nextUrl.searchParams.get("clientId") ?? session.clientId;
  if (!clientId) return NextResponse.json({ error: "clientId required" }, { status: 400 });

  return NextResponse.json(getQuickReplies(clientId));
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json() as {
    clientId?: string;
    shortcut: string;
    title: string;
    text: string;
    imageUrl?: string;
  };

  const cid = body.clientId ?? session.clientId;
  if (!cid) return NextResponse.json({ error: "clientId required" }, { status: 400 });
  if (!body.shortcut?.trim() || !body.title?.trim() || !body.text?.trim()) {
    return NextResponse.json({ error: "shortcut, title, text required" }, { status: 400 });
  }

  const reply = createQuickReply(cid, {
    shortcut: body.shortcut.trim().replace(/^\//, ""),
    title: body.title.trim(),
    text: body.text.trim(),
    imageUrl: body.imageUrl?.trim() || undefined,
  });

  return NextResponse.json(reply);
}
