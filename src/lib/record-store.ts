import { databaseExecutor, readDocument, writeDocument, withDataTransaction } from "./document-store";

type Collection = "leads.json" | "conversations.json" | "pending-responses.json" | "followups.json";
export type RecordFilter = { id?: string; clientId?: string; phone?: string; funnelId?: string; connId?: string | null; status?: string | string[]; type?: string; wamid?: string };
type ReadOptions = { before?: { field: "scheduledAt" | "respondAfter"; value: string }; limit?: number; summary?: boolean };
type Baseline = { collection: Collection; values: Map<string, string>; summary: boolean };
const baselines = new WeakMap<object, Baseline>();
const fileTest = () => process.env.NODE_ENV === "test" && !process.env.TEST_POSTGRES;

async function rows<T>(collection: Collection, filter: RecordFilter = {}, options: ReadOptions = {}): Promise<{ record_key: string; payload: T }[]> {
 const parameters: unknown[] = [collection], conditions = ["collection=$1"];
 const add = (value: unknown) => { parameters.push(value); return `$${parameters.length}`; };
 const columns = { id: "record_key", clientId: "client_id", funnelId: "funnel_id", connId: "connection_id", status: "status" };
 for (const key of Object.keys(columns) as (keyof typeof columns)[]) {
  const value = filter[key]; if (value === undefined) continue;
  const column = columns[key];
  conditions.push(value === null ? `${column} IS NULL` : Array.isArray(value) ? `${column}=ANY(${add(value)}::text[])` : `${column}=${add(value)}`);
 }
 if (filter.phone !== undefined) { const value = add(filter.phone); conditions.push(`(phone_norm=app_normalize_phone(${value}) OR real_phone_norm=app_normalize_phone(${value}))`); }
 if (filter.type !== undefined) conditions.push(`payload->>'type'=${add(filter.type)}`);
 if (filter.wamid !== undefined) conditions.push(`payload->>'wamid'=${add(filter.wamid)}`);
 if (options.before) {
  if (!["scheduledAt", "respondAfter"].includes(options.before.field)) throw Error("Filtro de data inválido.");
  conditions.push(`payload->>'${options.before.field}'<=${add(options.before.value)}`);
 }
 let projection = "payload";
 if (options.summary && collection === "conversations.json") projection = `jsonb_set(payload || jsonb_build_object('_messageCount',jsonb_array_length(coalesce(payload->'messages','[]'::jsonb))),'{messages}',CASE WHEN jsonb_array_length(coalesce(payload->'messages','[]'::jsonb))>0 THEN jsonb_build_array(payload->'messages'->-1) ELSE '[]'::jsonb END) AS payload`;
 const limit = options.limit === undefined ? "" : ` LIMIT ${add(Math.max(1, Math.min(10000, Math.trunc(options.limit))))}`;
 const result = await databaseExecutor().query<{ record_key: string; payload: T }>(`SELECT record_key,${projection} FROM app_records WHERE ${conditions.join(" AND ")} ORDER BY ${options.before ? `payload->>'${options.before.field}',record_key` : "record_key"}${limit}`, parameters);
 return result.rows;
}
export async function readRecordList<T extends { id: string }>(collection: Exclude<Collection, "conversations.json">, filter?: RecordFilter, options?: ReadOptions): Promise<T[]> {
 if (fileTest()) return readDocument<T[]>(collection, []);
 const records = await rows<T>(collection, filter, options); const values = records.map(record => record.payload);
 baselines.set(values, { collection, values: new Map(records.map(record => [record.record_key, JSON.stringify(record.payload)])), summary: false });
 return values;
}
export async function readRecordMap<T>(collection: "conversations.json", filter?: RecordFilter, options?: ReadOptions): Promise<Record<string, T>> {
 if (fileTest()) return readDocument<Record<string, T>>(collection, {});
 const records = await rows<T>(collection, filter, options), values = Object.fromEntries(records.map(record => [record.record_key, record.payload]));
 baselines.set(values, { collection, values: new Map(records.map(record => [record.record_key, JSON.stringify(record.payload)])), summary: !!options?.summary });
 return values;
}
async function persist(collection: Collection, value: object, entries: [string, unknown][], previous: object): Promise<void> {
 if (fileTest()) { await writeDocument(collection, value); return; }
 const baseline = baselines.get(previous);
 if (!baseline || baseline.collection !== collection || baseline.summary) throw Error("Gravação sem leitura completa do conjunto selecionado.");
 await withDataTransaction(async () => {
  const present = new Set<string>();
  for (const [key, payload] of entries) {
   if (!key || present.has(key)) throw Error("Registro sem identificador único."); present.add(key);
   const serialized = JSON.stringify(payload);
   if (baseline.values.get(key) === serialized) continue;
   await databaseExecutor().query(`INSERT INTO app_records(collection,record_key,payload) VALUES($1,$2,$3::jsonb) ON CONFLICT(collection,record_key) DO UPDATE SET payload=EXCLUDED.payload,revision=app_records.revision+1,updated_at=clock_timestamp()`, [collection,key,serialized]);
  }
  const removed = [...baseline.values.keys()].filter(key => !present.has(key));
  if (removed.length) await databaseExecutor().query("DELETE FROM app_records WHERE collection=$1 AND record_key=ANY($2::text[])", [collection,removed]);
  baselines.set(value, { collection, values: new Map(entries.map(([key,payload]) => [key, JSON.stringify(payload)])), summary: false });
 });
}
export async function writeRecordList<T extends { id: string }>(collection: Exclude<Collection, "conversations.json">, values: T[], previous: T[] = values): Promise<void> { await persist(collection, values, values.map(value => [value.id,value]), previous); }
export async function writeRecordMap<T>(collection: "conversations.json", values: Record<string, T>): Promise<void> { await persist(collection, values, Object.entries(values), values); }
