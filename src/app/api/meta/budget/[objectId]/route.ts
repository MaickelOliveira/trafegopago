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
  const { budget, type } = await req.json(); // budget em R$, type: 'daily' | 'lifetime'

  if (!budget || budget <= 0) {
    return NextResponse.json({ error: "Orçamento inválido" }, { status: 400 });
  }

  const token = getConfig().metaToken;
  // Meta API recebe orçamento em centavos (x100)
  const budgetCents = Math.round(budget * 100);
  const field = type === "lifetime" ? "lifetime_budget" : "daily_budget";

  const res = await fetch(`https://graph.facebook.com/v19.0/${objectId}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      [field]: String(budgetCents),
      access_token: token,
    }),
  });

  const data = await res.json();
  if (!res.ok || data.error) {
    return NextResponse.json({ error: data.error?.message || "Erro na API Meta" }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
