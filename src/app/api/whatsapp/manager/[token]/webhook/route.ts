import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { setWebhook, updateFieldsMap } from "@/lib/uazapi";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const session = await getSession();
  if (!session || session.role !== "manager") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { token } = await params;
  const { url } = await req.json() as { url: string };

  if (!url) {
    return NextResponse.json({ error: "URL obrigatória" }, { status: 400 });
  }

  await setWebhook(token, url);
  await updateFieldsMap(token);

  return NextResponse.json({ ok: true });
}
