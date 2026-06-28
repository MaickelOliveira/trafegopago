import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getClientById } from "@/lib/clients";
import { getGoogleAdsCreds } from "@/lib/google-ads-creds";
import { getAds, formatGoogleAdsError } from "@/lib/google-ads-api";
import { datePresetToRange } from "@/lib/date-presets";

type Params = { params: Promise<{ accountId: string; adsetId: string }> };

export async function GET(req: NextRequest, { params }: Params) {
  const { accountId, adsetId } = await params;
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 403 });

  if (session.role === "client") {
    const client = getClientById(session.clientId!);
    if (!client?.adAccounts.some((a) => a.id === accountId && a.platform === "google")) {
      return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
    }
  }

  const creds = getGoogleAdsCreds();
  if (!creds) return NextResponse.json({ error: "Google Ads não configurado" }, { status: 500 });

  const { searchParams } = new URL(req.url);
  const datePreset = searchParams.get("datePreset") || "last_30d";
  const { since, until } = datePresetToRange(datePreset);

  try {
    const ads = await getAds(creds, accountId, adsetId, since, until);
    return NextResponse.json(ads);
  } catch (e) {
    return NextResponse.json({ error: formatGoogleAdsError(e) }, { status: 500 });
  }
}
