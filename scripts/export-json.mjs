// Export CURRENT PostgreSQL state for a controlled rollback. Never read the
// original imported document for a collection whose live records have changed.
import { mkdir, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import pg from "pg";

const destination = process.argv[2];
if (!destination || !process.env.DATABASE_URL) throw Error("Informe DATABASE_URL e uma nova pasta privada de destino.");
const directory = path.resolve(destination);
await mkdir(directory, { mode: 0o700 }); // Refuse an existing destination.
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
let complete = false;
try {
  await client.connect();
  await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  const docs = (await client.query("SELECT name,payload FROM app_documents ORDER BY name")).rows;
  const records = (await client.query("SELECT collection,record_key,payload FROM app_records ORDER BY collection,record_key")).rows;
  const current = new Map(docs.map(row => [row.name, row.payload]));
  for (const collection of ["leads.json", "followups.json", "pending-responses.json"]) current.set(collection, records.filter(row => row.collection === collection).map(row => row.payload));
  current.set("conversations.json", Object.fromEntries(records.filter(row => row.collection === "conversations.json").map(row => [row.record_key, row.payload])));
  for (const [name,payload] of current) {
    if (!/^[a-z0-9][a-z0-9-]*\.json$/.test(name)) throw Error("Nome de coleção inválido.");
    await writeFile(path.join(directory,name), JSON.stringify(payload), { mode: 0o600, flag: "wx" });
  }
  await client.query("COMMIT");
  complete = true;
  console.log(JSON.stringify({ exported: current.size, records: records.length, consistentSnapshot: true, currentRecords: true }));
} finally {
  await client.end().catch(() => {});
  if (!complete) await rm(directory, { recursive: true, force: true });
}
