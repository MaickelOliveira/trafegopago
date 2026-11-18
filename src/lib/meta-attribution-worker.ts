import { createHash, randomUUID } from "node:crypto";
import { getClients, getConfig } from "./clients";
import { readDocument, writeDocument, withDataTransaction } from "./document-store";
import { readRecordList, writeRecordList } from "./record-store";
import type { Lead } from "./leads";
import { ATTRIBUTION_FIELDS, metaAttributionHints, normalizeLeadAttribution, hasReadableAttributionName } from "./lead-attribution";
import { resolveMetaAttribution, type MetaAttributionDetails, type MetaAttributionHints } from "./meta-attribution-api";

type Entry = { attempts: number; nextAttemptAt: number; leaseUntil?: number; claim?: string; details?: MetaAttributionDetails; checkedAt?: number };
type State = { entries: Record<string, Entry> };
type Group = { key: string; hints: MetaAttributionHints; accounts: string[]; leads: Lead[] };
const STATE = "meta-attribution-state.json";
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export const attributionRetryDelay = (attempt: number) => Math.min(6 * 3600000, 60000 * 5 ** Math.min(attempt - 1, 5));
function evidence(lead: Lead) {
  return hash([lead.clientId, lead.funnelId, metaAttributionHints(lead)]);
}
async function apply(group: Group, details?: MetaAttributionDetails) {
  let changed = 0;
  await withDataTransaction(async () => {
    for (const original of group.leads) {
      const rows = await readRecordList<Lead>("leads.json", { id: original.id });
      const current = rows.find(row => row.id === original.id);
      if (!current || evidence(current) !== evidence(original)) continue;
      const normalized = normalizeLeadAttribution(current);
      const patch: Partial<Lead> = {};
      for (const key of ATTRIBUTION_FIELDS) {
        const value = normalized[key];
        if (value !== current[key]) Object.assign(patch, { [key]: value });
      }
      // Existing readable manual labels are retained. Provider IDs/names fill missing metadata.
      if (details) for (const [key, value] of Object.entries(details)) {
        const existing = current[key as keyof Lead];
        if (current.campaignId && key.endsWith("Name") && hasReadableAttributionName(typeof existing === "string" ? existing : null)) continue;
        if (value) Object.assign(patch, { [key]: value });
      }
      if (!Object.keys(patch).length) continue;
      Object.assign(current, patch);
      // Metadata enrichment is not a conversation or conversion: preserve timestamps,
      // stages, pauses and consent; never call updateLead or fire workflow/CAPI events.
      await writeRecordList("leads.json", rows);
      changed++;
    }
  });
  return changed;
}
let running = false;
/** Reconciles every client's stored evidence, including leads captured while the worker was offline.
 * Claims and retry dates live in PostgreSQL, so restarts and multiple replicas are safe. */
export async function processMetaAttribution() {
  if (running) return { changed: 0, attempted: 0 };
  running = true;
  try {
    const [clients, config, leads] = await Promise.all([getClients(), getConfig(), readRecordList<Lead>("leads.json")]);
    const groups = new Map<string, Group>();
    const owners = new Map(clients.map(client => [client.id, client]));
    for (const lead of leads) {
      const hints = metaAttributionHints(lead);
      if (!hints) continue;
      const accounts = (owners.get(lead.clientId)?.adAccounts ?? []).filter(a => a.platform === "meta").map(a => a.id.replace(/^act_/, "")).sort();
      const key = hash([lead.clientId, accounts, hints, hash(config.metaToken ?? "")]);
      let group = groups.get(key);
      if (!group) { group = { key, hints, accounts, leads: [] }; groups.set(key, group); }
      group.leads.push(lead);
    }
    let changed = 0, attempted = 0;
    const state = await readDocument<State>(STATE, { entries: {} });
    for (const group of groups.values()) {
      changed += await apply(group, state.entries[group.key]?.details);
      if (!(group.hints.adId || group.hints.adSetId || group.hints.campaignId)) continue;
      const now = Date.now(), entry = state.entries[group.key];
      if (entry && (entry.nextAttemptAt > now || (entry.leaseUntil ?? 0) > now)) continue;
      if (attempted >= 10) continue;
      const claim = randomUUID();
      const claimed = await withDataTransaction(async () => {
        const fresh = await readDocument<State>(STATE, { entries: {} });
        const previous = fresh.entries[group.key];
        if (previous && (previous.nextAttemptAt > now || (previous.leaseUntil ?? 0) > now)) return false;
        fresh.entries[group.key] = { ...previous, attempts: previous?.attempts ?? 0, nextAttemptAt: now, leaseUntil: now + 120000, claim };
        await writeDocument(STATE, fresh);
        return true;
      });
      if (!claimed) continue;
      attempted++;
      let details: MetaAttributionDetails | undefined;
      try { details = (await resolveMetaAttribution(group.hints, group.accounts, config.metaToken ?? "")).details; }
      catch { /* Retry automatically, without dropping evidence or leaking provider errors. */ }
      await withDataTransaction(async () => {
        const fresh = await readDocument<State>(STATE, { entries: {} });
        const previous = fresh.entries[group.key];
        if (previous?.claim !== claim) return;
        const attempts = details ? 0 : previous.attempts + 1;
        fresh.entries[group.key] = { attempts, nextAttemptAt: Date.now() + (details ? 86400000 : attributionRetryDelay(attempts)), details: details ?? previous.details, checkedAt: Date.now() };
        // Bound obsolete credentials/account configurations; active cache entries remain.
        for (const [key, value] of Object.entries(fresh.entries)) if (!groups.has(key) && (value.checkedAt ?? 0) < now - 30 * 86400000) delete fresh.entries[key];
        await writeDocument(STATE, fresh);
      });
      if (details) changed += await apply(group, details);
    }
    return { changed, attempted };
  } finally { running = false; }
}
