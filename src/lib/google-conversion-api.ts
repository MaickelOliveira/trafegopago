import { enums } from "google-ads-api";
import { datamanager, type datamanager_v1 } from "googleapis/build/src/apis/datamanager/index.js";
import { createGoogleAdsCustomer } from "./google-ads-customer";
import type { GoogleAdsCreds } from "./google-ads-api";
import type { AppConfig } from "./clients";
import type { PlannedGoogleConversion, GoogleConversionKind } from "./google-conversion-plan";
import { createNexoGoogleOAuthClient } from "./google-nexo-auth";
import { hasGoogleConversionAuthorization } from "./google-conversion-auth";
import { GoogleConversionInputError } from "./google-conversion-settings";

export const CONVERSION_ACTION_NAMES = { qualified: "Nexo — Contato qualificado (CRM)", sale: "Nexo — Venda (CRM)" } as const;
type Action = { id: string; name: string; type: number; category: number; status: number; primary: boolean };
export async function inspectGoogleConversionActions(creds: GoogleAdsCreds, accountId: string) {
  if (!/^\d{10}$/.test(accountId)) throw Error("Invalid account");
  const customer = createGoogleAdsCustomer(creds, accountId);
  const rows = await customer.query("SELECT customer.conversion_tracking_setting.google_ads_conversion_customer, customer.conversion_tracking_setting.accepted_customer_data_terms FROM customer LIMIT 1");
  const tracking = rows[0]?.customer?.conversion_tracking_setting;
  const owner = tracking?.google_ads_conversion_customer?.split("/").pop();
  if (!owner || !/^\d{10}$/.test(owner)) throw Error("Conversion owner unavailable");
  const actions = await createGoogleAdsCustomer(creds, owner).query("SELECT conversion_action.id,conversion_action.name,conversion_action.type,conversion_action.category,conversion_action.status,conversion_action.primary_for_goal FROM conversion_action WHERE conversion_action.status != 'REMOVED'");
  return { conversionCustomerId: owner, termsAccepted: tracking?.accepted_customer_data_terms === true, actions: actions.map(row => ({ id: String(row.conversion_action?.id), name: row.conversion_action?.name || "", type: Number(row.conversion_action?.type), category: Number(row.conversion_action?.category), status: Number(row.conversion_action?.status), primary: row.conversion_action?.primary_for_goal === true })) as Action[] };
}
export async function prepareGoogleConversionActions(creds: GoogleAdsCreds, accountId: string) {
  const inspection = await inspectGoogleConversionActions(creds, accountId);
  if (!inspection.termsAccepted) throw new GoogleConversionInputError("Aceite os termos de dados do cliente na conta Google Ads antes de preparar as ações.");
  const customer = createGoogleAdsCustomer(creds, inspection.conversionCustomerId);
  const ids: Partial<Record<GoogleConversionKind, string>> = {};
  for (const kind of ["qualified", "sale"] as const) {
    const name = CONVERSION_ACTION_NAMES[kind];
    const existing = inspection.actions.filter(action => action.name === name);
    const category = kind === "qualified" ? enums.ConversionActionCategory.QUALIFIED_LEAD : enums.ConversionActionCategory.PURCHASE;
    if (existing.length > 1 || existing.some(action => action.type !== enums.ConversionActionType.UPLOAD_CLICKS || action.status !== enums.ConversionActionStatus.ENABLED || action.category !== category)) throw new GoogleConversionInputError("Existe uma ação com o mesmo nome e outra configuração. Revise as ações da conta Google Ads antes de continuar.");
    if (existing.length === 1) { ids[kind] = existing[0].id; continue; }
    const response = await customer.conversionActions.create([{
      name, type: enums.ConversionActionType.UPLOAD_CLICKS,
      category,
      status: enums.ConversionActionStatus.ENABLED,
      counting_type: kind === "qualified" ? enums.ConversionActionCountingType.ONE_PER_CLICK : enums.ConversionActionCountingType.MANY_PER_CLICK,
      primary_for_goal: false,
      click_through_lookback_window_days: 90,
      value_settings: { default_value: 0, default_currency_code: "BRL", always_use_default_value: false },
    }]);
    const id = response.results?.[0]?.resource_name?.split("/").pop();
    if (!id || !/^\d{1,20}$/.test(id)) throw Error("Conversion action response incomplete");
    ids[kind] = id;
  }
  return { conversionCustomerId: inspection.conversionCustomerId, qualifiedActionId: ids.qualified!, saleActionId: ids.sale! };
}

export function conversionPayload(event: PlannedGoogleConversion, loginCustomerId?: string, validateOnly = false): datamanager_v1.Schema$IngestEventsRequest {
  if (!event.gclid || event.skipReason || !/^\d{10}$/.test(event.conversionCustomerId) || !/^\d{1,20}$/.test(event.actionId) || !Number.isFinite(Date.parse(event.occurredAt)) || !Number.isFinite(event.value) || event.value < 0) throw Error("Invalid conversion event");
  const manager = loginCustomerId?.replace(/\D/g, "");
  return {
    validateOnly,
    destinations: [{ operatingAccount: { accountType: "GOOGLE_ADS", accountId: event.conversionCustomerId }, ...(manager ? { loginAccount: { accountType: "GOOGLE_ADS", accountId: manager } } : {}), productDestinationId: event.actionId }],
    // Only the click ID and conversion facts are sent. No assumed consent, names,
    // contact details, IP addresses, chat text or browser fingerprints are added.
    events: [{ adIdentifiers: { gclid: event.gclid }, eventTimestamp: new Date(event.occurredAt).toISOString(), eventSource: "OTHER", transactionId: event.id, conversionValue: event.value, currency: "BRL" }],
  };
}
function client(config: AppConfig) {
  if (!hasGoogleConversionAuthorization(config)) throw Error("Conversion authorization unavailable");
  const oauth = createNexoGoogleOAuthClient(config, process.env.APP_BASE_URL || config.appBaseUrl || "", "ads");
  oauth.setCredentials({ refresh_token: config.googleConversionsRefreshToken });
  return datamanager({ version: "v1", auth: oauth });
}
export async function ingestGoogleConversion(config: AppConfig, event: PlannedGoogleConversion, validateOnly = false) {
  const response = await client(config).events.ingest({ requestBody: conversionPayload(event, config.googleAdsLoginCustomerId, validateOnly) }, { timeout: 15000, retry: false });
  const warnings = !!(response.data as datamanager_v1.Schema$IngestEventsResponse & {fieldWarnings?: unknown[]}).fieldWarnings?.length;
  if (validateOnly) return { validated: true, requestId: null, warnings };
  if (!response.data.requestId || response.data.requestId.length > 500) throw Error("Missing request receipt");
  return { validated: false, requestId: response.data.requestId, warnings };
}
export async function googleConversionRequestStatus(config: AppConfig, requestId: string) {
  return (await client(config).requestStatus.retrieve({ requestId }, { timeout: 15000, retry: false })).data;
}
export function conversionError(error: unknown): { reason: string; retry: boolean } {
  const failure = error as { code?: string | number; response?: { status?: number } } | null;
  const status = failure?.response?.status;
  if (status === 401 || status === 403) return { reason: "google_connection", retry: true };
  if (status === 429) return { reason: "rate_limited", retry: true };
  if (status && status >= 400 && status < 500) return { reason: "google_rejected", retry: false };
  return { reason: "delivery_unconfirmed", retry: true };
}
export function conversionDiagnostic(data: datamanager_v1.Schema$RetrieveRequestStatusResponse, event: Pick<PlannedGoogleConversion, "conversionCustomerId" | "actionId">) {
  const result = data.requestStatusPerDestination?.find(row => row.destination?.operatingAccount?.accountId === event.conversionCustomerId && row.destination?.productDestinationId === event.actionId);
  const warnings = !!result?.warningInfo?.warningCounts?.length;
  if (!result || !["SUCCESS", "PARTIAL_SUCCESS", "FAILED"].includes(result.requestStatus || "")) return { status: "submitted" as const, reason: null, warnings };
  if (result.requestStatus === "SUCCESS" && Number(result.eventsIngestionStatus?.recordCount) === 1 && !result.errorInfo?.errorCounts?.length) return { status: "succeeded" as const, reason: null, warnings };
  return { status: "failed" as const, reason: "google_processing_failed", warnings };
}
