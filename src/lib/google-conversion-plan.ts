import { createHash } from "node:crypto";
import type { Client } from "./clients";
import type { Lead } from "./leads";

export type GoogleConversionKind = "qualified" | "sale";
export type GoogleConversionSettings = {
  enabled: boolean;
  enabledAt: string;
  accountId: string;
  conversionCustomerId: string;
  funnelId: string;
  qualifiedColumnId: string;
  saleColumnId: string;
  qualifiedActionId: string;
  saleActionId: string;
};
export type PlannedGoogleConversion = {
  id: string; clientId: string; leadId: string; kind: GoogleConversionKind;
  accountId: string; conversionCustomerId: string; actionId: string;
  occurredAt: string; value: number; gclid: string | null;
  skipReason: "missing_click" | "invalid_click" | "other_source" | null;
};

export function planGoogleConversion(client: Client, lead: Lead, previous?: Lead): PlannedGoogleConversion | null {
  const settings = client.googleConversions;
  if (!settings?.enabled || lead.clientId !== client.id || lead.funnelId !== settings.funnelId) return null;
  if (previous && (previous.id !== lead.id || previous.clientId !== lead.clientId)) return null;
  if (previous && previous.clientId === lead.clientId && previous.funnelId === lead.funnelId && previous.status === lead.status) return null;
  if (!Number.isFinite(Date.parse(settings.enabledAt)) || !Number.isFinite(Date.parse(lead.updatedAt)) || Date.parse(lead.updatedAt) < Date.parse(settings.enabledAt)) return null;
  if (!client.adAccounts.some(account => account.platform === "google" && account.id.replace(/\D/g, "") === settings.accountId)) return null;
  const kind = lead.status === settings.qualifiedColumnId ? "qualified" : lead.status === settings.saleColumnId ? "sale" : null;
  if (!kind) return null;
  const raw = typeof lead.gclid === "string" ? lead.gclid : "";
  const gclid = raw && /^[A-Za-z0-9_.~-]{5,2048}$/.test(raw) ? raw : null;
  const skipReason = lead.adPlatform === "meta" ? "other_source" : !raw ? "missing_click" : !gclid ? "invalid_click" : null;
  return {
    id: createHash("sha256").update(JSON.stringify(["nexo-google-crm-v1", client.id, lead.id, kind])).digest("hex"),
    clientId: client.id, leadId: lead.id, kind, accountId: settings.accountId,
    conversionCustomerId: settings.conversionCustomerId,
    actionId: kind === "qualified" ? settings.qualifiedActionId : settings.saleActionId,
    occurredAt: lead.updatedAt, value: kind === "sale" && typeof lead.value === "number" && Number.isFinite(lead.value) && lead.value >= 0 ? lead.value : 0,
    gclid: skipReason ? null : gclid, skipReason,
  };
}
