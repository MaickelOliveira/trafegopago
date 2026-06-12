import { NextRequest, NextResponse } from "next/server";
import { getFunnels } from "@/lib/funnels";

export const dynamic = "force-dynamic";

/** Testa uma conexão Meta chamando a Graph API direto (GET no phoneNumberId) — sem expor o token. */
export async function GET(req: NextRequest) {
  const connId = req.nextUrl.searchParams.get("connId");
  if (!connId) {
    return NextResponse.json({ error: "Use ?connId=<id da conexão>" }, { status: 400 });
  }

  const funnels = getFunnels();
  let found: { funnelId: string; phoneNumberId: string; token: string } | null = null;
  for (const f of funnels) {
    const conn = (f.connections ?? []).find((c) => c.id === connId);
    if (conn?.type === "meta" && conn.metaPhoneNumberId && conn.metaToken) {
      found = { funnelId: f.id, phoneNumberId: conn.metaPhoneNumberId, token: conn.metaToken };
      break;
    }
  }
  if (!found) return NextResponse.json({ error: "Conexão Meta não encontrada" }, { status: 404 });

  const res = await fetch(
    `https://graph.facebook.com/v19.0/${found.phoneNumberId}?fields=display_phone_number,verified_name,quality_rating,code_verification_status,platform_type`,
    { headers: { Authorization: `Bearer ${found.token}` } },
  );
  const body = await res.json().catch(() => ({}));
  return NextResponse.json({ funnelId: found.funnelId, phoneNumberId: found.phoneNumberId, status: res.status, body });
}
