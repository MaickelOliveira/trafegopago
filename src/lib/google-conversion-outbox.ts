import { databaseExecutor, databasePool } from "./document-store";
import { getClientById, getConfig } from "./clients";
import type { Lead } from "./leads";
import { planGoogleConversion, type PlannedGoogleConversion } from "./google-conversion-plan";
import { hasGoogleConversionAuthorization } from "./google-conversion-auth";
import type { PoolClient } from "pg";
import { getFunnelById } from "./funnels";

type QueueRow = { id: string; client_id: string; lead_id: string; kind: "qualified" | "sale"; account_id: string; conversion_customer_id: string; action_id: string; occurred_at: Date; value: string; gclid: string | null; attempts: number; status: string; request_id: string | null };
const asEvent = (row: QueueRow): PlannedGoogleConversion => ({ id: row.id, clientId: row.client_id, leadId: row.lead_id, kind: row.kind, accountId: row.account_id, conversionCustomerId: row.conversion_customer_id, actionId: row.action_id, occurredAt: row.occurred_at.toISOString(), value: Number(row.value), gclid: row.gclid, skipReason: null });

/** Called inside the same transaction that commits the lead's new stage. */
export async function enqueueLeadGoogleConversion(lead: Lead, previous?: Lead) {
  const client = await getClientById(lead.clientId);
  if (!client?.googleConversions?.enabled) return;
  if ((await getFunnelById(lead.funnelId))?.clientId !== client.id) return;
  const event = planGoogleConversion(client, lead, previous);
  if (!event) return;
  await databaseExecutor().query(`INSERT INTO google_conversion_events(id,client_id,lead_id,kind,account_id,conversion_customer_id,action_id,occurred_at,value,gclid,status,reason)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT(client_id,lead_id,kind) DO NOTHING`,
    [event.id,event.clientId,event.leadId,event.kind,event.accountId,event.conversionCustomerId,event.actionId,event.occurredAt,event.value,event.gclid,event.skipReason ? "skipped" : "pending",event.skipReason]);
}
let processing = false;
export async function processGoogleConversionOutbox(): Promise<void> {
  if (processing || process.env.TP_BACKGROUND_JOBS_ENABLED === "false") return;
  processing = true;
  let lock: PoolClient | undefined;
  let locked = false;
  try {
    lock = await databasePool().connect();
    locked = !!(await lock.query("SELECT pg_try_advisory_lock(721461,3) AS locked")).rows[0].locked;
    if (!locked) return;
    const config = await getConfig();
    if (!hasGoogleConversionAuthorization(config)) return;
    const due = await lock.query("SELECT EXISTS(SELECT 1 FROM google_conversion_events WHERE (status IN ('pending','submitted') AND next_attempt_at<=now()) OR (status='processing' AND processing_at<now()-interval '10 minutes')) AS due");
    if (!due.rows[0].due) return;
    const { conversionDiagnostic, conversionError, googleConversionRequestStatus, ingestGoogleConversion } = await import("./google-conversion-api");
    // A lost reply can be retried with the same transaction ID, never a new event.
    await lock.query("UPDATE google_conversion_events SET status='pending',reason='delivery_unconfirmed',next_attempt_at=now(),updated_at=now() WHERE status='processing' AND processing_at < now()-interval '10 minutes'");
    for (let i = 0; i < 5; i++) {
      const claim = await lock.query<QueueRow>(`UPDATE google_conversion_events SET status='processing',attempts=attempts+1,processing_at=now(),updated_at=now()
        WHERE id=(SELECT id FROM google_conversion_events WHERE status='pending' AND next_attempt_at<=now() ORDER BY next_attempt_at,id LIMIT 1 FOR UPDATE SKIP LOCKED) RETURNING *`);
      const row = claim.rows[0]; if (!row) break;
      const current = await getClientById(row.client_id);
      const settings = current?.googleConversions;
      const funnel = settings ? await getFunnelById(settings.funnelId) : undefined;
      if (!settings?.enabled || funnel?.clientId !== row.client_id || Date.parse(settings.enabledAt) > row.occurred_at.getTime() || settings.accountId !== row.account_id || settings.conversionCustomerId !== row.conversion_customer_id || (row.kind === "qualified" ? settings.qualifiedActionId : settings.saleActionId) !== row.action_id || !current?.adAccounts.some(account => account.platform === "google" && account.id.replace(/\D/g, "") === row.account_id)) {
        await lock.query("UPDATE google_conversion_events SET status='cancelled',reason='settings_changed',gclid=NULL,updated_at=now() WHERE id=$1", [row.id]); continue;
      }
      try {
        const result = await ingestGoogleConversion(config, asEvent(row));
        await lock.query("UPDATE google_conversion_events SET status='submitted',request_id=$2,submitted_at=now(),next_attempt_at=now()+interval '30 minutes',warnings=warnings OR $3,reason=NULL,updated_at=now() WHERE id=$1", [row.id,result.requestId,result.warnings]);
      } catch (error) {
        const failure = conversionError(error);
        const retry = failure.retry && row.attempts < 10;
        const delay = failure.reason === "google_connection" ? 3600 : Math.min(21600,60*2**Math.min(row.attempts,8));
        await lock.query("UPDATE google_conversion_events SET status=$2,reason=$3,next_attempt_at=now()+make_interval(secs=>$4),gclid=CASE WHEN $2='failed' THEN NULL ELSE gclid END,updated_at=now() WHERE id=$1",[row.id,retry ? "pending" : "failed",failure.reason,delay]);
        if (failure.reason === "google_connection" || failure.reason === "rate_limited") break;
      }
    }
    const submitted = (await lock.query<QueueRow>("SELECT * FROM google_conversion_events WHERE status='submitted' AND next_attempt_at<=now() ORDER BY next_attempt_at,id LIMIT 5")).rows;
    for (const row of submitted) {
      if (!row.request_id) continue;
      try {
        const result = conversionDiagnostic(await googleConversionRequestStatus(config,row.request_id),asEvent(row));
        await lock.query("UPDATE google_conversion_events SET status=$2,reason=$3,warnings=warnings OR $4,next_attempt_at=now()+interval '1 hour',gclid=CASE WHEN $2 IN ('succeeded','failed') THEN NULL ELSE gclid END,updated_at=now() WHERE id=$1",[row.id,result.status,result.reason,result.warnings]);
      } catch {
        // Do not resubmit a receipt that is merely awaiting diagnostics.
        await lock.query("UPDATE google_conversion_events SET next_attempt_at=now()+interval '1 hour',reason='diagnostics_unavailable',updated_at=now() WHERE id=$1",[row.id]);
      }
    }
  } finally {
    if (locked && lock) await lock.query("SELECT pg_advisory_unlock(721461,3)").catch(() => {});
    lock?.release(); processing = false;
  }
}
export async function googleConversionHistory(clientId: string) {
  const counts = (await databaseExecutor().query<{status:string;count:number}>("SELECT status,count(*)::int AS count FROM google_conversion_events WHERE client_id=$1 GROUP BY status",[clientId])).rows;
  const recent = (await databaseExecutor().query("SELECT id,kind,status,reason,warnings,occurred_at,submitted_at,updated_at FROM google_conversion_events WHERE client_id=$1 ORDER BY created_at DESC LIMIT 12",[clientId])).rows;
  return { counts, recent };
}
