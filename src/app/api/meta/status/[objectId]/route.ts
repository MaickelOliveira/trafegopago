import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getConfig } from "@/lib/clients";

type Params = { params: Promise<{ objectId: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  const session = await getSession();
  if (!session || session.role !== "manager") {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }

  const { objectId } = await params;
  const { status } = await req.json(); // "ACTIVE" | "PAUSED"

  if (status !== "ACTIVE" && status !== "PAUSED") {
    return NextResponse.json({ error: "Status inválido" }, { status: 400 });
  }

  const token = getConfig().metaToken;

  const res = await fetch(`https://graph.facebook.com/v19.0/${objectId}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ status, access_token: token }),
  });

  const data = await res.json();
  if (!res.ok || data.error) {
    return NextResponse.json({ error: data.error?.message || "Erro na API Meta" }, { status: 400 });
  }

  return NextResponse.json({ ok: true, status });
}
