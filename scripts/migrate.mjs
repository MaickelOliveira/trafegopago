import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import pg from "pg";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL obrigatória.");
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
try {
  await client.connect();
  await client.query("BEGIN");
  await client.query("SELECT pg_advisory_xact_lock(721461, 1)");
  // Existing production instances can run with DML-only credentials. Creating a
  // new schema remains the responsibility of the maintenance account.
  if (!(await client.query("SELECT to_regclass('public.schema_migrations') AS name")).rows[0].name) {
    await client.query("CREATE TABLE schema_migrations(name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())");
  }
  const directory = fileURLToPath(new URL("../db/", import.meta.url));
  for (const name of (await readdir(directory)).filter(name => /^\d+.*\.sql$/.test(name)).sort()) {
    if ((await client.query("SELECT 1 FROM schema_migrations WHERE name=$1", [name])).rowCount) continue;
    await client.query(await readFile(`${directory}/${name}`, "utf8"));
    await client.query("INSERT INTO schema_migrations(name) VALUES($1)", [name]);
    console.log(`Migração aplicada: ${name}`);
  }
  await client.query("COMMIT");
} catch (error) {
  await client.query("ROLLBACK").catch(() => {});
  console.error("A migração falhou; nenhuma alteração parcial foi mantida.");
  process.exitCode = 1;
} finally { await client.end(); }
