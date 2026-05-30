const BASE = "https://graph.facebook.com/v19.0";

async function metaGet(path: string, params: Record<string, string>, token: string) {
  const url = new URL(`${BASE}${path}`);
  url.searchParams.set("access_token", token);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url.toString(), { next: { revalidate: 120 } });
  if (!res.ok) throw new Error(`Meta API error: ${await res.text()}`);
  return res.json();
}

export type MetaInsights = {
  spend: number;
  impressions: number;
  clicks: number;
  ctr: number;
  cpc: number;
  cpm: number;
  reach: number;
  frequency: number;
  // Mensagens / WhatsApp
  conversations: number;
  costPerConversation: number | null;
  // Leads (formulário)
  leads: number;
  costPerLead: number | null;
  // Vendas no site
  purchases: number;
  costPerPurchase: number | null;
  revenue: number;
  roas: number | null;
  // Funil de vendas
  addToCart: number;
  checkouts: number;
  // Tráfego
  linkClicks: number;
  landingPageViews: number;
  // Vídeo
  videoViews: number;
};

type RawAction = { action_type: string; value: string };
type RawInsights = Record<string, string | RawAction[]>;

function parseInsights(ins: RawInsights): MetaInsights {
  const actions = (ins.actions as RawAction[]) || [];
  const cpa   = (ins.cost_per_action_type as RawAction[]) || [];
  const vals  = (ins.action_values as RawAction[]) || [];

  const sumActions = (...keys: string[]) =>
    actions.filter((a) => keys.some((k) => a.action_type === k || a.action_type.includes(k)))
      .reduce((s, a) => s + parseFloat(a.value), 0);

  const findCPA = (...keys: string[]) => {
    const hit = cpa.find((a) => keys.some((k) => a.action_type === k || a.action_type.includes(k)));
    return hit ? parseFloat(hit.value) : null;
  };

  const sumValues = (...keys: string[]) =>
    vals.filter((a) => keys.some((k) => a.action_type === k || a.action_type.includes(k)))
      .reduce((s, a) => s + parseFloat(a.value), 0);

  const spend = parseFloat((ins.spend as string) || "0");

  const purchases = sumActions("purchase", "omni_purchase", "offsite_conversion.fb_pixel_purchase");
  const revenue   = sumValues("purchase", "omni_purchase", "offsite_conversion.fb_pixel_purchase");
  const costPerPurchase = purchases > 0
    ? (findCPA("purchase", "omni_purchase", "offsite_conversion.fb_pixel_purchase") ?? (spend / purchases))
    : null;
  const roas = spend > 0 && revenue > 0 ? revenue / spend : null;

  const leads = sumActions("lead", "onsite_conversion.lead_grouped");
  const costPerLead = leads > 0
    ? (findCPA("lead", "onsite_conversion.lead_grouped") ?? (spend / leads))
    : null;

  const conversations = sumActions("messaging_conversation_started_7d");
  const costPerConversation = conversations > 0
    ? (findCPA("messaging_conversation_started_7d") ?? (spend / conversations))
    : null;

  const addToCart  = sumActions("add_to_cart", "omni_add_to_cart", "offsite_conversion.fb_pixel_add_to_cart");
  const checkouts  = sumActions("initiate_checkout", "omni_initiated_checkout", "offsite_conversion.fb_pixel_initiate_checkout");
  const linkClicks = sumActions("link_click");
  const landingPageViews = sumActions("landing_page_view");

  return {
    spend,
    impressions: parseInt((ins.impressions as string) || "0"),
    clicks: parseInt((ins.clicks as string) || "0"),
    ctr: parseFloat((ins.ctr as string) || "0"),
    cpc: parseFloat((ins.cpc as string) || "0"),
    cpm: parseFloat((ins.cpm as string) || "0"),
    reach: parseInt((ins.reach as string) || "0"),
    frequency: parseFloat((ins.frequency as string) || "0"),
    conversations,
    costPerConversation,
    leads,
    costPerLead,
    purchases,
    costPerPurchase,
    revenue,
    roas,
    addToCart,
    checkouts,
    linkClicks,
    landingPageViews,
    videoViews: sumActions("video_view"),
  };
}

const INSIGHT_FIELDS =
  "spend,impressions,clicks,ctr,cpc,cpm,reach,frequency,actions,action_values,cost_per_action_type";

export async function getAccountInsights(
  accountId: string,
  token: string,
  datePreset = "last_30d"
) {
  const data = await metaGet(`/${accountId}/insights`, {
    fields: INSIGHT_FIELDS,
    date_preset: datePreset,
  }, token);
  return data.data?.[0] ? parseInsights(data.data[0]) : null;
}

export async function getAccountInsightsRange(
  accountId: string,
  token: string,
  since: string,
  until: string
) {
  const data = await metaGet(`/${accountId}/insights`, {
    fields: INSIGHT_FIELDS,
    time_range: JSON.stringify({ since, until }),
  }, token);
  return data.data?.[0] ? parseInsights(data.data[0]) : null;
}

export async function getDailyInsights(
  id: string,
  token: string,
  since: string,
  until: string
) {
  const data = await metaGet(`/${id}/insights`, {
    fields: "spend,impressions,clicks,ctr,cpm,reach,actions,cost_per_action_type",
    time_range: JSON.stringify({ since, until }),
    time_increment: "1",
    limit: "90",
  }, token);
  return (data.data || []).map((d: Record<string, string>) => ({
    date: d.date_start,
    spend: parseFloat(d.spend || "0"),
    impressions: parseInt(d.impressions || "0"),
    clicks: parseInt(d.clicks || "0"),
    ctr: parseFloat(d.ctr || "0"),
    cpm: parseFloat(d.cpm || "0"),
    reach: parseInt(d.reach || "0"),
  }));
}

export type MetaCampaign = {
  id: string;
  name: string;
  status: string;
  objective: string;
  dailyBudget: number | null;
  lifetimeBudget: number | null;
  insights: MetaInsights | null;
};

export async function getCampaigns(
  accountId: string,
  token: string,
  datePreset = "last_30d"
): Promise<MetaCampaign[]> {
  const data = await metaGet(`/${accountId}/campaigns`, {
    fields: `name,status,objective,daily_budget,lifetime_budget,insights.date_preset(${datePreset}){${INSIGHT_FIELDS}}`,
    limit: "50",
  }, token);

  return (data.data || []).map((c: Record<string, string | { data: Record<string, string>[] }>) => ({
    id: c.id as string,
    name: c.name as string,
    status: c.status as string,
    objective: (c.objective as string) || "",
    dailyBudget: c.daily_budget ? parseInt(c.daily_budget as string) / 100 : null,
    lifetimeBudget: c.lifetime_budget ? parseInt(c.lifetime_budget as string) / 100 : null,
    insights: (c.insights as { data: Record<string, string | { action_type: string; value: string }[]>[] })?.data?.[0]
      ? parseInsights((c.insights as { data: Record<string, string | { action_type: string; value: string }[]>[] }).data[0])
      : null,
  }));
}

export type MetaAdSet = {
  id: string;
  name: string;
  status: string;
  optimizationGoal: string;
  dailyBudget: number | null;
  insights: MetaInsights | null;
};

export async function getAdSets(
  campaignId: string,
  token: string,
  datePreset = "last_30d"
): Promise<MetaAdSet[]> {
  const data = await metaGet(`/${campaignId}/adsets`, {
    fields: `name,status,optimization_goal,daily_budget,insights.date_preset(${datePreset}){${INSIGHT_FIELDS}}`,
    limit: "50",
  }, token);

  return (data.data || []).map((a: Record<string, string | { data: Record<string, string>[] }>) => ({
    id: a.id as string,
    name: a.name as string,
    status: a.status as string,
    optimizationGoal: (a.optimization_goal as string) || "",
    dailyBudget: a.daily_budget ? parseInt(a.daily_budget as string) / 100 : null,
    insights: (a.insights as { data: Record<string, string | { action_type: string; value: string }[]>[] })?.data?.[0]
      ? parseInsights((a.insights as { data: Record<string, string | { action_type: string; value: string }[]>[] }).data[0])
      : null,
  }));
}

export type MetaCreative = {
  id: string;
  name: string;
  thumbnailUrl: string | null;
  imageUrl: string | null;
  videoId: string | null;
  igMediaId: string | null;
  title: string | null;
  body: string | null;
  callToAction: string | null;
};

export type MetaAd = {
  id: string;
  name: string;
  status: string;
  creative: MetaCreative | null;
  insights: MetaInsights | null;
};

export async function getAds(
  adsetId: string,
  token: string,
  datePreset = "last_30d"
): Promise<MetaAd[]> {
  const data = await metaGet(`/${adsetId}/ads`, {
    fields: `name,status,creative{id,name,thumbnail_url,image_url,video_id,title,body,call_to_action_type,object_story_spec,effective_instagram_media_id},insights.date_preset(${datePreset}){${INSIGHT_FIELDS}}`,
    limit: "30",
  }, token);

  return (data.data || []).map((ad: Record<string, unknown>) => {
    const raw = ad.creative as Record<string, unknown> | undefined;

    // O video_id correto está em object_story_spec.video_data.video_id
    const storySpec = raw?.object_story_spec as Record<string, Record<string, string>> | undefined;
    const storyVideoId = storySpec?.video_data?.video_id || null;
    // image_url do story é alta resolução; thumbnail_url da API é 64x64
    const storyImageUrl = storySpec?.video_data?.image_url || null;

    const videoId = storyVideoId || (raw?.video_id as string) || null;
    // storyImageUrl pode ser facebook.com/ads/image/?d=... (requer auth, browser não carrega)
    // só usar storyImageUrl se for uma URL pública (fbcdn.net ou cdninstagram.com)
    const isPublicUrl = (url: string | null) =>
      !!url && (url.includes("fbcdn.net") || url.includes("cdninstagram.com") || url.includes("scontent"));
    const imageUrl = isPublicUrl(raw?.image_url as string)
      ? (raw?.image_url as string)
      : isPublicUrl(storyImageUrl)
      ? storyImageUrl
      : null;
    // Para o thumbnail do card: usar só URLs públicas; IG media_url vai substituir depois
    const thumbnailUrl = isPublicUrl(raw?.thumbnail_url as string)
      ? (raw?.thumbnail_url as string)
      : isPublicUrl(storyImageUrl)
      ? storyImageUrl
      : null;

    return {
      id: ad.id as string,
      name: ad.name as string,
      status: ad.status as string,
      creative: raw
        ? {
            id: raw.id as string,
            name: (raw.name as string) || "",
            thumbnailUrl,
            imageUrl,
            videoId,
            igMediaId: (raw?.effective_instagram_media_id as string) || null,
            title: (raw.title as string) || null,
            body: (raw.body as string) || null,
            callToAction: (raw.call_to_action_type as string) || null,
          }
        : null,
      insights: (ad.insights as { data: Record<string, string | { action_type: string; value: string }[]>[] })?.data?.[0]
        ? parseInsights((ad.insights as { data: Record<string, string | { action_type: string; value: string }[]>[] }).data[0])
        : null,
    };
  });
}

// ─── Lookup por ad_id (usado para rastreio CTWa via QR/UazapiGO) ──────────────

export type MetaAdInfo = {
  adId: string;
  adName: string | null;
  adSetId: string | null;
  adSetName: string | null;
  campaignId: string | null;
  campaignName: string | null;
};

/**
 * Busca nome de campanha, conjunto e anúncio a partir do ad_id recebido no
 * referral de mensagens Click-to-WhatsApp (CTWa) via UazapiGO.
 * Requer token com permissão ads_read.
 */
export async function getAdInfoById(adId: string, token: string): Promise<MetaAdInfo | null> {
  try {
    const data = await metaGet(`/${adId}`, {
      fields: "name,adset_id,campaign_id,adset{id,name,campaign{id,name}}",
    }, token);
    return {
      adId,
      adName: (data.name as string) ?? null,
      adSetId: (data.adset_id as string) ?? (data.adset?.id as string) ?? null,
      adSetName: (data.adset?.name as string) ?? null,
      campaignId: (data.campaign_id as string) ?? (data.adset?.campaign?.id as string) ?? null,
      campaignName: (data.adset?.campaign?.name as string) ?? null,
    };
  } catch (err) {
    console.warn("[getAdInfoById] Falha ao buscar ad info:", err instanceof Error ? err.message : err);
    return null;
  }
}
