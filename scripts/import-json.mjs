import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import pg from "pg";

// SOURCE_DATA_DIR must be a frozen copy, never the live volume of the old app.
if (!process.env.DATABASE_URL || !process.env.SOURCE_DATA_DIR) throw new Error("Configure DATABASE_URL e SOURCE_DATA_DIR.");
const manifest = JSON.parse(await readFile(new URL("../db/legacy-collections.json", import.meta.url), "utf8"));
const source = path.resolve(process.env.SOURCE_DATA_DIR);
if (!process.argv.includes("--frozen-snapshot")) throw new Error("A importação exige uma cópia consistente dos dados (--frozen-snapshot).");
const snapshots = [];
for (const name of manifest) {
  const filename = path.join(source, name);
  let text;
  try { text = await readFile(filename, "utf8"); }
  catch (error) { if (error.code === "ENOENT") continue; throw error; }
  const payload = JSON.parse(text); // corruption is an error, never an empty replacement
  if (!payload || typeof payload !== "object") throw new Error(`Coleção inválida: ${name}`);
  if (name === "clients.json" && !Array.isArray(payload.clients)) throw new Error("Formato de clientes inválido.");
  snapshots.push({ name, payload });
}
for (const required of ["config.json", "clients.json", "funnels.json"]) {
  if (!snapshots.some(item => item.name === required)) throw new Error(`Coleção obrigatória ausente: ${required}`);
}
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
try {
  await client.connect();
  await client.query("BEGIN");
  await client.query("SELECT pg_advisory_xact_lock(721461, 1)");
  if ((await client.query("SELECT 1 FROM app_documents UNION ALL SELECT 1 FROM app_records LIMIT 1")).rowCount) throw new Error("O destino já contém dados; importação recusada.");
  for (const item of snapshots) {
    await client.query("INSERT INTO app_documents(name,payload) VALUES($1,$2::jsonb)", [item.name, JSON.stringify(item.payload)]);
    const verified = await client.query("SELECT payload = $2::jsonb AS matches FROM app_documents WHERE name=$1", [item.name, JSON.stringify(item.payload)]);
    if (!verified.rows[0]?.matches) throw new Error("Falha de conferência na importação.");
  }
  await client.query("SELECT import_legacy_records()");
  await client.query("COMMIT");
  console.log(JSON.stringify({ imported: snapshots.length, verified: true }));
} catch (error) {
  await client.query("ROLLBACK").catch(() => {});
  console.error(error.message.startsWith("O destino") ? error.message : "Importação recusada ou inválida. O destino não recebeu dados parciais.");
  process.exitCode = 1;
} finally { await client.end(); }
