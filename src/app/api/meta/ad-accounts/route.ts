import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getConfig } from "@/lib/clients";

export async function GET() {
  const session = await getSession();
  if (!session || session.role !== "manager") {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }

  const token = getConfig().metaToken;
  if (!token) {
    return NextResponse.json({ error: "Token Meta não configurado" }, { status: 400 });
  }

  const url = `https://graph.facebook.com/v19.0/me/adaccounts?fields=id,name,account_id&limit=100&access_token=${token}`;
  const res = await fetch(url);
  const data = await res.json();

  if (data.error) {
    return NextResponse.json({ error: data.error.message }, { status: 400 });
  }

  const accounts = (data.data ?? []).map((a: { id: string; name: string; account_id: string }) => ({
    id: `act_${a.account_id}`,
    name: a.name,
    platform: "meta" as const,
  }));

  return NextResponse.json(accounts);
}
