import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { ownsAdAccount } from "@/lib/ad-account-access";
import { getClientById } from "@/lib/clients";
import { getGoogleAdsCreds } from "@/lib/google-ads-creds";
import { getAdGroups, formatGoogleAdsError, googleAdsIssue } from "@/lib/google-ads-api";
import { datePresetToRange } from "@/lib/date-presets";

type Params = { params: Promise<{ accountId: string; campaignId: string }> };

export async function GET(req: NextRequest, { params }: Params) {
  const { accountId, campaignId } = await params;
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 403 });

  if (session.role !== "manager") {
    const client = (await getClientById(session.clientId!));
    if (!client || !ownsAdAccount(client.adAccounts, "google", accountId)) {
      return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
    }
  }

  const creds = (await getGoogleAdsCreds());
  if (!creds) return NextResponse.json({ error: "Google Ads não configurado" }, { status: 500 });

  const { searchParams } = new URL(req.url);
  const datePreset = searchParams.get("datePreset") || "last_30d";
  const { since, until } = datePresetToRange(datePreset);

  try {
    const adGroups = await getAdGroups(creds, accountId, campaignId, since, until);
    return NextResponse.json(adGroups);
  } catch (e) {
    return NextResponse.json({ error: formatGoogleAdsError(e), googleAdsIssue: googleAdsIssue(e) }, { status: 500 });
  }
}
