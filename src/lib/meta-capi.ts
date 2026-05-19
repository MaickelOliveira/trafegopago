import crypto from "crypto";
import { getConfig } from "./clients";

function sha256(value: string): string {
  return crypto.createHash("sha256").update(value.trim().toLowerCase()).digest("hex");
}

export async function sendCapiEvent(opts: {
  pixelId: string;
  eventName: string;
  phone?: string;
  email?: string;
  externalId?: string;
  value?: number;
  currency?: string;
}): Promise<void> {
  const { metaToken } = getConfig();
  if (!metaToken || !opts.pixelId) return;

  const userData: Record<string, string> = {};
  if (opts.phone) userData.ph = sha256(opts.phone.replace(/\D/g, ""));
  if (opts.email) userData.em = sha256(opts.email);
  if (opts.externalId) userData.external_id = sha256(opts.externalId);

  const eventData: Record<string, unknown> = {
    event_name: opts.eventName,
    event_time: Math.floor(Date.now() / 1000),
    action_source: "other",
    user_data: userData,
  };
  if (opts.value != null) {
    eventData.custom_data = { currency: opts.currency ?? "BRL", value: opts.value };
  }

  const payload = {
    data: [eventData],
    access_token: metaToken,
  };

  const res = await fetch(
    `https://graph.facebook.com/v19.0/${opts.pixelId}/events`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }
  ).catch(() => null);

  if (res && !res.ok) {
    const err = await res.json().catch(() => ({}));
    console.error("[Meta CAPI]", err);
  }
}
