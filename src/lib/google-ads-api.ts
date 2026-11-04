import { enums, errors, ResourceNames, toMicros, fields } from "google-ads-api";
import { createGoogleAdsCustomer } from "./google-ads-customer";

export type GoogleAdsCreds = {
  clientId: string;
  clientSecret: string;
  developerToken?: string; // Legacy compatibility; Google now authorizes the Cloud project.
  refreshToken: string;
  loginCustomerId?: string;
};

function digits(s: string): string {
  return s.replace(/\D/g, "");
}

type RawGoogleAdsError = { message?: string; error_code?: { authorization_error?: number | string; quota_error?: number | string } };
type RawGoogleAdsFailure = { errors?: RawGoogleAdsError[]; error?: unknown; response?: { data?: { error?: unknown }; status?: number } };
export type GoogleAdsIssue = "authorization_expired" | "account_access" | "project_access" | "rate_limited" | "unavailable";

export function googleAdsIssue(error: unknown): GoogleAdsIssue {
  const failure = error as RawGoogleAdsFailure | null;
  if (failure?.error === "invalid_grant" || failure?.response?.data?.error === "invalid_grant" || error instanceof Error && /\binvalid_grant\b/i.test(error.message)) return "authorization_expired";
  for (const item of Array.isArray(failure?.errors) ? failure.errors : []) {
    const code = item?.error_code?.authorization_error;
    const authorization = errors.AuthorizationErrorEnum.AuthorizationError;
    const matches = (name: string) => code === name || typeof code === "number" && code === (authorization as unknown as Record<string, number>)[name];
    if (["USER_PERMISSION_DENIED", "INVALID_LOGIN_CUSTOMER_ID_SERVING_CUSTOMER_ID_COMBINATION", "CUSTOMER_NOT_ENABLED", "ACCESS_DENIED_FOR_ACCOUNT_TYPE"].some(matches)) return "account_access";
    if (["CLOUD_PROJECT_NOT_APPROVED_FOR_PRODUCTION", "ACTION_NOT_PERMITTED", "DEVELOPER_TOKEN_NOT_APPROVED", "PROJECT_DISABLED", "SERVICE_ACCESS_DENIED"].some(matches)) return "project_access";
    const quota = item?.error_code?.quota_error;
    if (quota != null && quota !== 0 && quota !== "UNSPECIFIED") return "rate_limited";
  }
  if (failure?.response?.status === 429) return "rate_limited";
  return "unavailable";
}

/** Classify provider codes without returning request details or secret values. */
export function formatGoogleAdsError(e: unknown): string {
  // Provider messages can contain request data. Return only a known classification.
  const issue = googleAdsIssue(e);
  if (issue === "authorization_expired") return "invalid_grant";
  if (issue === "account_access") return "A conexão Google não tem acesso a esta conta de anúncios. Confira a conta vinculada e as permissões no Google Ads.";
  if (issue === "project_access") return "O projeto Google precisa de liberação para acessar contas reais. Confira o nível de acesso da Google Ads API no Google Cloud.";
  if (issue === "rate_limited") return "O limite de consultas do Google Ads foi atingido. Aguarde e tente novamente.";
  return "Não foi possível consultar o Google Ads.";
}

function buildCustomer(creds: GoogleAdsCreds, customerId: string) {
  return createGoogleAdsCustomer(creds, customerId);
}

/** ENABLED/PAUSED/REMOVED (Google) → ACTIVE/PAUSED/ARCHIVED (vocabulário já usado na UI, igual à Meta). */
function normalizeStatus(s: unknown): string {
  const str = String(s ?? "");
  if (str === "ENABLED" || str === "2") return "ACTIVE";
  if (str === "PAUSED" || str === "3") return "PAUSED";
  if (str === "REMOVED" || str === "4") return "ARCHIVED";
  return str || "UNKNOWN";
}

export type GoogleInsights = {
  spend: number;
  impressions: number;
  clicks: number;
  ctr: number;
  cpc: number;
  cpm: number;
  conversions: number;
  conversionsValue: number;
  costPerConversion: number | null;
  roas: number | null;
};

function fromMicros(v: unknown): number {
  const n = Number(v ?? 0);
  return n / 1_000_000;
}

type RawMetrics = {
  cost_micros?: number | string;
  impressions?: number | string;
  clicks?: number | string;
  ctr?: number | string;
  average_cpc?: number | string;
  average_cpm?: number | string;
  conversions?: number | string;
  conversions_value?: number | string;
  cost_per_conversion?: number | string;
};

function parseInsights(m: RawMetrics | undefined): GoogleInsights | null {
  if (!m) return null;
  const spend = fromMicros(m.cost_micros);
  const conversionsValue = Number(m.conversions_value ?? 0);
  return {
    spend,
    impressions: Number(m.impressions ?? 0),
    clicks: Number(m.clicks ?? 0),
    // metrics.ctr já vem como proporção (0-1) na API do Google Ads — risco já
    // sinalizado no plano: confirmar contra uma conta real e multiplicar por
    // 100 aqui se a UI espera porcentagem (igual a Meta) e não proporção.
    ctr: Number(m.ctr ?? 0) * 100,
    cpc: fromMicros(m.average_cpc),
    cpm: fromMicros(m.average_cpm),
    conversions: Number(m.conversions ?? 0),
    conversionsValue,
    costPerConversion: m.cost_per_conversion ? fromMicros(m.cost_per_conversion) : null,
    roas: spend > 0 && conversionsValue > 0 ? conversionsValue / spend : null,
  };
}

const METRICS_FIELDS: fields.Metric[] = [
  "metrics.cost_micros",
  "metrics.impressions",
  "metrics.clicks",
  "metrics.ctr",
  "metrics.average_cpc",
  "metrics.average_cpm",
  "metrics.conversions",
  "metrics.conversions_value",
  "metrics.cost_per_conversion",
];

export type GoogleCampaign = {
  id: string;
  name: string;
  status: string;
  channelType: string;
  dailyBudget: number | null;
  budgetResourceId: string | null;
  insights: GoogleInsights | null;
};

export async function getCampaigns(
  creds: GoogleAdsCreds,
  customerId: string,
  since: string,
  until: string,
): Promise<GoogleCampaign[]> {
  const customer = buildCustomer(creds, customerId);
  const rows = await customer.report({
    entity: "campaign",
    attributes: [
      "campaign.id",
      "campaign.name",
      "campaign.status",
      "campaign.advertising_channel_type",
      "campaign_budget.id",
      "campaign_budget.amount_micros",
    ],
    metrics: METRICS_FIELDS,
    from_date: since,
    to_date: until,
  });

  return rows.map((r) => {
    const c = r.campaign as Record<string, unknown> | undefined;
    const budget = r.campaign_budget as Record<string, unknown> | undefined;
    return {
      id: String(c?.id ?? ""),
      name: String(c?.name ?? ""),
      status: normalizeStatus(c?.status),
      channelType: String(c?.advertising_channel_type ?? ""),
      dailyBudget: budget?.amount_micros != null ? fromMicros(budget.amount_micros) : null,
      budgetResourceId: budget?.id != null ? String(budget.id) : null,
      insights: parseInsights(r.metrics as RawMetrics | undefined),
    };
  });
}

export async function getCampaignLabels(creds: GoogleAdsCreds, customerId: string): Promise<{ id: string; name: string }[]> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const query = buildCustomer(creds, customerId).report({ entity: "campaign", attributes: ["campaign.id", "campaign.name"] });
  const rows = await Promise.race([query, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(Error("Campaign names unavailable")), 15000); })]).finally(() => { if (timer) clearTimeout(timer); });
  return rows.map(row => ({ id: String(row.campaign?.id ?? ""), name: String(row.campaign?.name ?? "") })).filter(row => row.id && row.name);
}

export type GoogleAdGroup = {
  id: string;
  name: string;
  status: string;
  type: string;
  insights: GoogleInsights | null;
};

export async function getAdGroups(
  creds: GoogleAdsCreds,
  customerId: string,
  campaignId: string,
  since: string,
  until: string,
): Promise<GoogleAdGroup[]> {
  const customer = buildCustomer(creds, customerId);
  const rows = await customer.report({
    entity: "ad_group",
    attributes: ["ad_group.id", "ad_group.name", "ad_group.status", "ad_group.type"],
    metrics: METRICS_FIELDS,
    constraints: { "campaign.id": campaignId },
    from_date: since,
    to_date: until,
  });

  return rows.map((r) => {
    const ag = r.ad_group as Record<string, unknown> | undefined;
    return {
      id: String(ag?.id ?? ""),
      name: String(ag?.name ?? ""),
      status: normalizeStatus(ag?.status),
      type: String(ag?.type ?? ""),
      insights: parseInsights(r.metrics as RawMetrics | undefined),
    };
  });
}

export type GoogleAdCreative = {
  headlines: string[];
  descriptions: string[];
  finalUrl: string | null;
};

export type GoogleAd = {
  id: string;
  name: string | null;
  status: string;
  creative: GoogleAdCreative | null;
  insights: GoogleInsights | null;
};

export async function getAds(
  creds: GoogleAdsCreds,
  customerId: string,
  adGroupId: string,
  since: string,
  until: string,
): Promise<GoogleAd[]> {
  const customer = buildCustomer(creds, customerId);
  const rows = await customer.report({
    entity: "ad_group_ad",
    attributes: [
      "ad_group_ad.ad.id",
      "ad_group_ad.ad.name",
      "ad_group_ad.status",
      "ad_group_ad.ad.responsive_search_ad.headlines",
      "ad_group_ad.ad.responsive_search_ad.descriptions",
      "ad_group_ad.ad.final_urls",
    ],
    metrics: METRICS_FIELDS,
    constraints: { "ad_group.id": adGroupId },
    from_date: since,
    to_date: until,
  });

  return rows.map((r) => {
    const aga = r.ad_group_ad as Record<string, unknown> | undefined;
    const ad = (aga?.ad as Record<string, unknown> | undefined) ?? {};
    const rsa = ad.responsive_search_ad as Record<string, unknown> | undefined;
    const headlines = ((rsa?.headlines as { text?: string }[] | undefined) ?? []).map((h) => h.text ?? "").filter(Boolean);
    const descriptions = ((rsa?.descriptions as { text?: string }[] | undefined) ?? []).map((d) => d.text ?? "").filter(Boolean);
    const finalUrls = ad.final_urls as string[] | undefined;
    return {
      id: String(ad.id ?? ""),
      name: (ad.name as string) || (headlines[0] ?? null),
      status: normalizeStatus(aga?.status),
      creative: headlines.length || descriptions.length ? { headlines, descriptions, finalUrl: finalUrls?.[0] ?? null } : null,
      insights: parseInsights(r.metrics as RawMetrics | undefined),
    };
  });
}

export async function getAccountInsightsRange(
  creds: GoogleAdsCreds,
  customerId: string,
  since: string,
  until: string,
): Promise<GoogleInsights | null> {
  const customer = buildCustomer(creds, customerId);
  const rows = await customer.report({
    entity: "customer",
    metrics: METRICS_FIELDS,
    from_date: since,
    to_date: until,
  });
  return rows.length ? parseInsights(rows[0].metrics as RawMetrics | undefined) : null;
}

export async function getDailyInsights(
  creds: GoogleAdsCreds,
  customerId: string,
  since: string,
  until: string,
): Promise<{ date: string; spend: number; impressions: number; clicks: number; ctr: number; cpm: number }[]> {
  const customer = buildCustomer(creds, customerId);
  const rows = await customer.report({
    entity: "customer",
    segments: ["segments.date"],
    metrics: METRICS_FIELDS,
    from_date: since,
    to_date: until,
  });
  return rows.map((r) => {
    const seg = r.segments as Record<string, unknown> | undefined;
    const insights = parseInsights(r.metrics as RawMetrics | undefined);
    return {
      date: String(seg?.date ?? ""),
      spend: insights?.spend ?? 0,
      impressions: insights?.impressions ?? 0,
      clicks: insights?.clicks ?? 0,
      ctr: insights?.ctr ?? 0,
      cpm: insights?.cpm ?? 0,
    };
  });
}

/** Edita o orçamento DIÁRIO de uma campanha. `budgetResourceId` é o id do
 *  campaign_budget (de GoogleCampaign.budgetResourceId), NÃO o id da campanha —
 *  no Google Ads orçamento é um recurso próprio, diferente da Meta. Só suporta
 *  orçamento diário na v1 (orçamento "lifetime"/total não é suportado). */
export async function updateCampaignBudget(
  creds: GoogleAdsCreds,
  customerId: string,
  budgetResourceId: string,
  budgetReais: number,
): Promise<void> {
  const customer = buildCustomer(creds, customerId);
  const resourceName = ResourceNames.campaignBudget(digits(customerId), budgetResourceId);
  await customer.campaignBudgets.update([
    { resource_name: resourceName, amount_micros: toMicros(budgetReais) },
  ]);
}

export async function updateCampaignStatus(
  creds: GoogleAdsCreds,
  customerId: string,
  campaignId: string,
  status: "ACTIVE" | "PAUSED",
): Promise<void> {
  const customer = buildCustomer(creds, customerId);
  const resourceName = ResourceNames.campaign(digits(customerId), campaignId);
  await customer.campaigns.update([
    { resource_name: resourceName, status: status === "ACTIVE" ? enums.CampaignStatus.ENABLED : enums.CampaignStatus.PAUSED },
  ]);
}

export async function updateAdGroupStatus(
  creds: GoogleAdsCreds,
  customerId: string,
  adGroupId: string,
  status: "ACTIVE" | "PAUSED",
): Promise<void> {
  const customer = buildCustomer(creds, customerId);
  const resourceName = ResourceNames.adGroup(digits(customerId), adGroupId);
  await customer.adGroups.update([
    { resource_name: resourceName, status: status === "ACTIVE" ? enums.AdGroupStatus.ENABLED : enums.AdGroupStatus.PAUSED },
  ]);
}

/** Pausa/ativa um anúncio (ad_group_ad). Diferente de campanha/ad group, o
 *  resource name de um anúncio precisa do adGroupId junto com o id do anúncio. */
export async function updateAdStatus(
  creds: GoogleAdsCreds,
  customerId: string,
  adGroupId: string,
  adId: string,
  status: "ACTIVE" | "PAUSED",
): Promise<void> {
  const customer = buildCustomer(creds, customerId);
  const resourceName = ResourceNames.adGroupAd(digits(customerId), adGroupId, adId);
  await customer.adGroupAds.update([
    { resource_name: resourceName, status: status === "ACTIVE" ? enums.AdGroupAdStatus.ENABLED : enums.AdGroupAdStatus.PAUSED },
  ]);
}
