import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getConfig, getClientById } from "@/lib/clients";
import { getCampaigns } from "@/lib/meta-api";

type Params = { params: Promise<{ accountId: string }> };

export async function GET(req: NextRequest, { params }: Params) {
  const { accountId } = await params;
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 403 });

  if (session.role === "client") {
    const client = getClientById(session.clientId!);
    if (!client?.adAccounts.some((a) => a.id === accountId)) {
      return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
    }
  }

  const token = getConfig().metaToken;
  const { searchParams } = new URL(req.url);
  const datePreset = searchParams.get("datePreset") || "last_30d";

  try {
    const campaigns = await getCampaigns(accountId, token, datePreset);
    return NextResponse.json(campaigns);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
