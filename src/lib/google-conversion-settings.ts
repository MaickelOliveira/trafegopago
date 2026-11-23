import type { Client } from "./clients";
import type { Funnel } from "./funnels";
import type { GoogleConversionSettings } from "./google-conversion-plan";
import { enums } from "google-ads-api";
import type { inspectGoogleConversionActions } from "./google-conversion-api";

export class GoogleConversionInputError extends Error {}
export function ownedGoogleConversionAccount(client: Client, value: unknown): string {
  if (typeof value !== "string") throw new GoogleConversionInputError("Escolha a conta Google Ads deste cliente.");
  const id = value.replace(/-/g, "");
  if (!/^\d{10}$/.test(id) || !client.adAccounts.some(account => account.platform === "google" && account.id.replace(/\D/g, "") === id)) throw new GoogleConversionInputError("Escolha a conta Google Ads deste cliente.");
  return id;
}
export function validateGoogleConversionSettings(client: Client, body: Record<string, unknown>, funnels: Funnel[], inspection: Awaited<ReturnType<typeof inspectGoogleConversionActions>>): GoogleConversionSettings {
  const accountId = ownedGoogleConversionAccount(client, body.accountId);
  if (body.enabled !== true || !inspection.termsAccepted) throw new GoogleConversionInputError("Conclua a configuração de conversões da conta Google.");
  const funnel = funnels.find(item => item.id === body.funnelId && item.clientId === client.id);
  if (!funnel) throw new GoogleConversionInputError("Escolha um funil deste cliente.");
  const qualifiedColumnId = body.qualifiedColumnId;
  const saleColumnId = body.saleColumnId;
  if (typeof qualifiedColumnId !== "string" || typeof saleColumnId !== "string" || qualifiedColumnId === saleColumnId || !funnel.columns.some(column => column.id === qualifiedColumnId) || !funnel.columns.some(column => column.id === saleColumnId)) throw new GoogleConversionInputError("Escolha etapas diferentes para contato qualificado e venda.");
  const qualifiedAction = inspection.actions.find(action => action.id === body.qualifiedActionId && action.type === enums.ConversionActionType.UPLOAD_CLICKS && action.status === enums.ConversionActionStatus.ENABLED && action.category === enums.ConversionActionCategory.QUALIFIED_LEAD);
  const saleAction = inspection.actions.find(action => action.id === body.saleActionId && action.type === enums.ConversionActionType.UPLOAD_CLICKS && action.status === enums.ConversionActionStatus.ENABLED && action.category === enums.ConversionActionCategory.PURCHASE);
  if (!qualifiedAction || !saleAction || qualifiedAction.id === saleAction.id) throw new GoogleConversionInputError("Prepare as ações de contato qualificado e venda na conta Google selecionada.");
  const settings = { enabled: true, enabledAt: new Date().toISOString(), accountId, conversionCustomerId: inspection.conversionCustomerId, funnelId: funnel.id, qualifiedColumnId, saleColumnId, qualifiedActionId: qualifiedAction.id, saleActionId: saleAction.id };
  const previous = client.googleConversions;
  if (previous?.enabled && (Object.keys(settings) as (keyof GoogleConversionSettings)[]).every(key => key === "enabledAt" || previous[key] === settings[key])) settings.enabledAt = previous.enabledAt;
  return settings;
}
