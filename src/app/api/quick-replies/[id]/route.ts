import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { updateQuickReply, deleteQuickReply } from "@/lib/quick-replies";

type Params = Promise<{ id: string }>;
export const dynamic = "force-dynamic";

export async function PUT(req: NextRequest, { params }: { params: Params }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = await req.json() as {
    clientId?: string;
    shortcut?: string;
    title?: string;
    text?: string;
    imageUrl?: string;
  };

  const cid = body.clientId ?? session.clientId;
  if (!cid) return NextResponse.json({ error: "clientId required" }, { status: 400 });

  const updated = updateQuickReply(cid, id, {
    shortcut: body.shortcut?.trim().replace(/^\//, ""),
    title: body.title?.trim(),
    text: body.text?.trim(),
    imageUrl: body.imageUrl?.trim() || undefined,
  });

  if (!updated) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(updated);
}

export async function DELETE(req: NextRequest, { params }: { params: Params }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const clientId = req.nextUrl.searchParams.get("clientId") ?? session.clientId;
  if (!clientId) return NextResponse.json({ error: "clientId required" }, { status: 400 });

  const ok = deleteQuickReply(clientId, id);
  return NextResponse.json({ ok });
}
