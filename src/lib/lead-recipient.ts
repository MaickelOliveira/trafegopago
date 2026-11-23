import type { AvisoRecipient } from "./clients";
import { normalizeAgentPhone } from "./agent-phone-policy";

export function normalizeRecipient(type: "phone" | "group", input: string): string {
  const value = input.trim();
  if (type === "group") return /^\d+(?:-\d+)?@g\.us$/.test(value) ? value : "";
  const digits = normalizeAgentPhone(value);
  return /^\+?[\d() .-]+$/.test(value) && /^[1-9]\d{7,14}$/.test(digits) ? digits : "";
}


export function parseLeadRecipients(raw: unknown, allowGroups: boolean): AvisoRecipient[] | null {
  if (!Array.isArray(raw)) return null;
  const result: AvisoRecipient[] = [];
  for (const r of raw) {
    if (!r || typeof r.id !== "string" || typeof r.label !== "string" || !r.label.trim() ||
        typeof r.value !== "string" || (r.type !== "phone" && !(allowGroups && r.type === "group"))) return null;
    const value = normalizeRecipient(r.type, r.value);
    if (!value) return null;
    if (!result.some(item => item.value === value)) result.push({ id: r.id, type: r.type, label: r.label.trim(), value });
  }
  return result;
}
