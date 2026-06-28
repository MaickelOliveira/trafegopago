import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getGoogleAdsCreds } from "@/lib/google-ads-creds";
import { getCampaigns, getAdGroups, getAds, getAccountInsightsRange, getDailyInsights, formatGoogleAdsError } from "@/lib/google-ads-api";
import { datePresetToRange } from "@/lib/date-presets";

// Rota TEMPORÁRIA pra validar as queries GAQL contra uma conta real antes de
// ligar a UI. Manager-only. Remover (ou os usos que já tiverem sido validados)
// ao final da implementação — ver passo 7 do plano.
// Uso: /api/debug/google-ads-test?customerId=1234567890&what=campaigns
//      &campaignId=...&adGroupId=...&datePreset=last_30d

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "manager") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const creds = getGoogleAdsCreds();
  if (!creds) {
    return NextResponse.json({ error: "Google Ads não configurado (faltam credenciais em Configurações)" }, { status: 500 });
  }

  const { searchParams } = req.nextUrl;
  const customerId = searchParams.get("customerId");
  if (!customerId) return NextResponse.json({ error: "customerId obrigatório" }, { status: 400 });

  const what = searchParams.get("what") || "campaigns";
  const { since, until } = datePresetToRange(searchParams.get("datePreset") || "last_30d");

  try {
    if (what === "campaigns") {
      return NextResponse.json(await getCampaigns(creds, customerId, since, until));
    }
    if (what === "adgroups") {
      const campaignId = searchParams.get("campaignId");
      if (!campaignId) return NextResponse.json({ error: "campaignId obrigatório" }, { status: 400 });
      return NextResponse.json(await getAdGroups(creds, customerId, campaignId, since, until));
    }
    if (what === "ads") {
      const adGroupId = searchParams.get("adGroupId");
      if (!adGroupId) return NextResponse.json({ error: "adGroupId obrigatório" }, { status: 400 });
      return NextResponse.json(await getAds(creds, customerId, adGroupId, since, until));
    }
    if (what === "insights") {
      return NextResponse.json(await getAccountInsightsRange(creds, customerId, since, until));
    }
    if (what === "daily") {
      return NextResponse.json(await getDailyInsights(creds, customerId, since, until));
    }
    return NextResponse.json({ error: "what inválido (campaigns|adgroups|ads|insights|daily)" }, { status: 400 });
  } catch (e) {
    console.error("[debug/google-ads-test] Error:", JSON.stringify(e, Object.getOwnPropertyNames(e as object)));
    return NextResponse.json({ error: formatGoogleAdsError(e) }, { status: 500 });
  }
}
