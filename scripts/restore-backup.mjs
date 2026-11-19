import { spawn } from "node:child_process";
import { mkdtemp, rm, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import pg from "pg";

const source = process.argv[2];
if (!source || !process.env.RESTORE_DATABASE_URL) throw new Error("Informe o backup e RESTORE_DATABASE_URL de um banco vazio e separado.");
if (process.env.RESTORE_DATABASE_URL === process.env.DATABASE_URL) throw new Error("Não restaure sobre o banco ativo.");
const target = new URL(process.env.RESTORE_DATABASE_URL);
const active = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL) : null;
if (active && target.pathname === active.pathname && target.host === active.host && target.searchParams.get("host") === active.searchParams.get("host")) throw new Error("O destino é o banco ativo.");
const client = new pg.Client({ connectionString: target.toString() });
const directory = await mkdtemp(path.join(tmpdir(), "trafegopago-restore-"));
const plaintext = path.join(directory, "database.dump");
async function execute(binary, args, env = process.env) {
  const child = spawn(binary, args, { env, stdio: ["ignore", "ignore", "pipe"] });
  child.stderr.resume();
  await new Promise((resolve, reject) => { child.on("error", reject); child.on("exit", code => code === 0 ? resolve() : reject(new Error("Falha ao restaurar o backup."))); });
}
try {
  await client.connect();
  const tables = await client.query("SELECT 1 FROM information_schema.tables WHERE table_schema='public' LIMIT 1");
  if (tables.rowCount) throw new Error("O banco de destino não está vazio.");
  await execute(process.execPath, ["scripts/decrypt-backup.mjs", await realpath(source), plaintext]);
  const env = { ...process.env, PGDATABASE: decodeURIComponent(target.pathname.slice(1)), PGHOST: target.searchParams.get("host") || target.hostname, PGPORT: target.port || "5432", PGUSER: decodeURIComponent(target.username), PGPASSWORD: decodeURIComponent(target.password), PGSSLMODE: target.searchParams.get("sslmode") || process.env.PGSSLMODE || "prefer" };
  await execute(process.env.PG_RESTORE_BIN || "pg_restore", ["--no-owner", "--no-acl", "--exit-on-error", "--single-transaction", "--dbname", env.PGDATABASE, plaintext], env);
  const result = await client.query("SELECT count(*)::integer AS collections FROM app_documents");
  console.log(JSON.stringify({ restored: true, collections: result.rows[0].collections }));
} finally {
  await client.end();
  // Only the directory created above, containing our plaintext copy, is removed.
  await rm(directory, { recursive: true, force: true });
}
