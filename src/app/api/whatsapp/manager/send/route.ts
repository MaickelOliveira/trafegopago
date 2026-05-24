import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { sendText, sendMedia } from "@/lib/uazapi";

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "manager") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json() as {
    token: string;
    phone: string;
    type: "text" | "image" | "audio" | "video";
    content: string;
    caption?: string;
  };

  const { token, phone, type, content, caption } = body;

  if (!token || !phone || !content) {
    return NextResponse.json({ error: "token, phone e content são obrigatórios" }, { status: 400 });
  }

  const cleanPhone = phone.replace(/\D/g, "");

  let ok: boolean;
  if (type === "text") {
    ok = await sendText(token, cleanPhone, content);
  } else {
    ok = await sendMedia(token, cleanPhone, type as "image" | "audio" | "video", content, caption);
  }

  return NextResponse.json({ ok });
}
