import { AsyncLocalStorage } from "node:async_hooks";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";

type Transaction = { client: PoolClient; active: boolean; documents: Map<string, unknown>; dirty: Set<string> };
const context = new AsyncLocalStorage<Transaction>();
let pool: Pool | undefined;

export function databasePool(): Pool {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL não configurada.");
  pool ??= new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 10,
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 30_000,
    statement_timeout: 30_000,
    application_name: "trafegopago",
  });
  return pool;
}

export function databaseExecutor() {
  const tx = context.getStore();
  return tx?.active ? tx.client : databasePool();
}

function keyOf(name: string) {
  if (!/^[a-z0-9][a-z0-9-]*\.json$/.test(name)) throw new Error("Coleção inválida.");
  return name;
}

/** A transaction covers the complete read/change/write operation, including claims.
 * The lock is shared across processes; a second worker cannot claim the same job.
 * No WhatsApp or advertising request belongs inside these short CRUD operations. */
export async function withDataTransaction<T>(operation: () => Promise<T>): Promise<T> {
  if (context.getStore()?.active || process.env.NODE_ENV === "test" && !process.env.TEST_POSTGRES) return operation();
  const client = await databasePool().connect();
  const tx: Transaction = { client, active: true, documents: new Map(), dirty: new Set() };
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL lock_timeout = '10s'");
    await client.query("SELECT pg_advisory_xact_lock(721461, 1)");
    const result = await context.run(tx, operation);
    for (const name of [...tx.dirty].sort()) await persistDocument(client, name, tx.documents.get(name));
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    tx.active = false;
    client.release();
  }
}

export async function readDocument<T>(name: string, fallback: T): Promise<T> {
  const key = keyOf(name);
  // Existing unit tests use a temporary directory. Production has no file fallback.
  if (process.env.NODE_ENV === "test" && !process.env.TEST_POSTGRES) {
    try { return JSON.parse(await readFile(path.join(process.cwd(), "data", key), "utf8")) as T; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return structuredClone(fallback);
      throw error;
    }
  }
  const tx = context.getStore();
  if (tx?.active && tx.documents.has(key)) return tx.documents.get(key) as T;
  const result = await databaseExecutor().query<{ payload: T }>(
    "SELECT payload FROM app_documents WHERE name = $1", [key],
  );
  const payload = result.rows.length ? result.rows[0].payload : structuredClone(fallback);
  if (tx?.active) tx.documents.set(key, payload);
  return payload;
}

export async function writeDocument(name: string, payload: unknown): Promise<void> {
  const key = keyOf(name);
  if (process.env.NODE_ENV === "test" && !process.env.TEST_POSTGRES) {
    const dir = path.join(process.cwd(), "data");
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const temporary = path.join(dir, `.${key}.${randomUUID()}.tmp`);
    await writeFile(temporary, JSON.stringify(payload), { mode: 0o600 });
    await rename(temporary, path.join(dir, key));
    return;
  }
  const tx = context.getStore();
  if (tx?.active) {
    tx.documents.set(key, payload);
    tx.dirty.add(key);
    return;
  }
  await persistDocument(databasePool(), key, payload);
}

async function persistDocument(executor: Pool | PoolClient, key: string, payload: unknown) {
  await executor.query(
    `INSERT INTO app_documents(name, payload) VALUES ($1, $2::jsonb)
     ON CONFLICT (name) DO UPDATE SET payload = EXCLUDED.payload,
       revision = app_documents.revision + 1, updated_at = clock_timestamp()`,
    [key, JSON.stringify(payload)],
  );
}
