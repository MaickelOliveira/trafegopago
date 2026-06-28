import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getClientById } from "@/lib/clients";
import { getGoogleAdsCreds } from "@/lib/google-ads-creds";
import { getAccountInsightsRange, getDailyInsights, formatGoogleAdsError, type GoogleAdsCreds } from "@/lib/google-ads-api";
import { datePresetToRange } from "@/lib/date-presets";

type Params = { params: Promise<{ accountId: string }> };

/** null = sem permissão (403); undefined = autorizado mas sem credenciais configuradas (500) */
async function authorize(accountId: string): Promise<GoogleAdsCreds | null | undefined> {
  const session = await getSession();
  if (!session) return null;

  if (session.role !== "manager") {
    const client = getClientById(session.clientId!);
    const owns = client?.adAccounts.some((a) => a.id === accountId && a.platform === "google");
    if (!owns) return null;
  }
  return getGoogleAdsCreds() ?? undefined;
}

export async function GET(req: NextRequest, { params }: Params) {
  const { accountId } = await params;
  const creds = await authorize(accountId);
  if (creds === null) return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  if (!creds) return NextResponse.json({ error: "Google Ads não configurado" }, { status: 500 });

  const { searchParams } = new URL(req.url);
  const datePreset = searchParams.get("datePreset");
  let since = searchParams.get("since");
  let until = searchParams.get("until");
  const daily = searchParams.get("daily") === "1";

  if (!since || !until) {
    const range = datePresetToRange(datePreset || "last_30d");
    since = range.since;
    until = range.until;
  }

  try {
    if (daily) {
      const data = await getDailyInsights(creds, accountId, since, until);
      return NextResponse.json(data);
    }
    const data = await getAccountInsightsRange(creds, accountId, since, until);
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json({ error: formatGoogleAdsError(e) }, { status: 500 });
  }
}
