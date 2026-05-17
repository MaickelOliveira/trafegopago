import { NextResponse } from "next/server";
import { getDemoCampaigns, getDemoDailyMetrics } from "@/lib/demo-data";
import { generateAlerts, buildAccountSummary } from "@/lib/metrics";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const platform = searchParams.get("platform") as "meta" | "google" | null;
  const status = searchParams.get("status");

  const isDemoMode = process.env.NEXT_PUBLIC_DEMO_MODE === "true";

  let campaigns = isDemoMode
    ? getDemoCampaigns()
    : await fetchLiveCampaigns(); // fallback gracioso

  if (platform) {
    campaigns = campaigns.filter((c) => c.platform === platform);
  }
  if (status) {
    campaigns = campaigns.filter((c) => c.status === status);
  }

  const alerts = generateAlerts(campaigns);
  const dailyMetrics = getDemoDailyMetrics(30);

  const metaSummary = buildAccountSummary(campaigns, "meta", "Meta Ads");
  const googleSummary = buildAccountSummary(campaigns, "google", "Google Ads");

  return NextResponse.json({
    campaigns,
    alerts,
    dailyMetrics,
    accountSummaries: [metaSummary, googleSummary],
  });
}

// Quando NEXT_PUBLIC_DEMO_MODE=false, conecta à API real do Meta
async function fetchLiveCampaigns() {
  const accountId = process.env.META_AD_ACCOUNT_ID;
  const accessToken = process.env.META_ACCESS_TOKEN;

  if (!accountId || !accessToken) {
    console.warn("Credenciais Meta não configuradas — usando modo demo");
    return getDemoCampaigns();
  }

  const fields = [
    "id", "name", "status", "objective", "daily_budget", "start_time", "stop_time",
    "insights.date_preset(last_30d){impressions,clicks,spend,actions,action_values,reach,frequency}",
  ].join(",");

  const url = `https://graph.facebook.com/v19.0/${accountId}/campaigns?fields=${encodeURIComponent(fields)}&access_token=${accessToken}`;

  const res = await fetch(url, { next: { revalidate: 300 } });
  if (!res.ok) {
    console.error("Erro na API Meta:", await res.text());
    return getDemoCampaigns();
  }

  // TODO: transformar resposta da API Meta no formato Campaign
  return getDemoCampaigns();
}
