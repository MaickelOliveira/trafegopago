import { metaObjectBelongsToAccount } from "@/lib/ad-account-access";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getConfig, getClientById } from "@/lib/clients";
import { getAdSets } from "@/lib/meta-api";

type Params = { params: Promise<{ accountId: string; campaignId: string }> };

export async function GET(req: NextRequest, { params }: Params) {
  const { accountId, campaignId } = await params;
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 403 });

  if (session.role === "client") {
    const client = (await getClientById(session.clientId!));
    if (!client?.adAccounts.some((a) => a.id === accountId)) {
      return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
    }
  }

  const token = (await getConfig()).metaToken;
  if (session.role !== "manager" && !await metaObjectBelongsToAccount(campaignId,accountId,token)) return NextResponse.json({ error: "Acesso não permitido." }, { status: 403 });
  const { searchParams } = new URL(req.url);
  const datePreset = searchParams.get("datePreset") || "last_30d";

  try {
    const adsets = await getAdSets(campaignId, token, datePreset);
    return NextResponse.json(adsets);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
