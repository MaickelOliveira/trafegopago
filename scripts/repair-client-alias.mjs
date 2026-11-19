// Reconcile a confirmed historical alias. Dry-run by default, one transaction,
// no provider calls, no automatic sends, and no guessing when histories collide.
import pg from "pg";
const from = process.argv[process.argv.indexOf("--from") + 1];
const to = process.argv[process.argv.indexOf("--to") + 1];
const apply = process.argv.includes("--apply");
if (!process.env.DATABASE_URL || !from || !to || from.startsWith("--") || to.startsWith("--") || from === to || !process.argv.includes("--from") || !process.argv.includes("--to")) throw Error("Informe DATABASE_URL, --from e --to.");
if (apply && (!process.argv.includes("--confirmed-same-client") || !process.argv.includes("--backup-verified"))) throw Error("Confirme a identidade e o backup antes de aplicar.");
function rewrite(value) {
  if (Array.isArray(value)) return value.map(rewrite);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key,item]) => [key,key === "clientId" && item === from ? to : rewrite(item)]));
  return value;
}
const client = new pg.Client({connectionString:process.env.DATABASE_URL});
try {
  await client.connect(); await client.query("BEGIN"); await client.query("SELECT pg_advisory_xact_lock(721461,1)");
  const clients = (await client.query("SELECT payload FROM app_documents WHERE name='clients.json'")).rows[0]?.payload?.clients ?? [];
  if (!clients.some(item => item.id === to) || clients.some(item => item.id === from)) throw Error("O destino precisa existir e o identificador antigo não pode ser outro cliente ativo.");
  const collisions = await client.query("SELECT 1 FROM app_records old JOIN app_records current ON current.collection=old.collection AND current.record_key=$2||substr(old.record_key,length($1)+1) WHERE old.collection='conversations.json' AND left(old.record_key,length($1)+1)=$1||':' LIMIT 1",[from,to]);
  if (collisions.rowCount) throw Error("Há históricos sobrepostos. A reconciliação automática foi recusada.");
  const hot = ["leads.json","followups.json","pending-responses.json","conversations.json"];
  const docs = (await client.query("SELECT name,payload FROM app_documents WHERE NOT(name=ANY($1))",[hot])).rows;
  const changedDocs = docs.map(row => ({...row,after:rewrite(row.payload)})).filter(row=>JSON.stringify(row.payload)!==JSON.stringify(row.after));
  const records = (await client.query("SELECT collection,record_key,payload FROM app_records WHERE client_id=$1 OR collection='conversations.json' AND left(record_key,length($1)+1)=$1||':'",[from])).rows;
  if(records.some(row=>row.payload.clientId && ![from,to].includes(row.payload.clientId)))throw Error("Um histórico tem outro proprietário. Revise antes de reconciliar.");
  const plan = {dryRun:!apply,documentsChanged:changedDocs.map(row=>row.name),recordsChanged:records.length,conversationsRenamed:records.filter(row=>row.collection==='conversations.json'&&row.record_key.startsWith(from+':')).length,externalMessagesSent:false};
  if (apply && (changedDocs.length || records.length)) {
    for (const row of changedDocs) await client.query("UPDATE app_documents SET payload=$2,revision=revision+1,updated_at=clock_timestamp() WHERE name=$1",[row.name,JSON.stringify(row.after)]);
    for (const row of records) await client.query("UPDATE app_records SET record_key=$3,payload=$4,revision=revision+1,updated_at=clock_timestamp() WHERE collection=$1 AND record_key=$2",[row.collection,row.record_key,row.collection==='conversations.json'&&row.record_key.startsWith(from+':')?to+row.record_key.slice(from.length):row.record_key,JSON.stringify(rewrite(row.payload))]);
    await client.query("INSERT INTO app_documents(name,payload) VALUES('scope-repair-audit.json',jsonb_build_array(jsonb_build_object('from',$1::text,'to',$2::text,'at',clock_timestamp(),'records',$3::int,'documents',$4::jsonb))) ON CONFLICT(name) DO UPDATE SET payload=app_documents.payload||EXCLUDED.payload,revision=app_documents.revision+1",[from,to,records.length,JSON.stringify(plan.documentsChanged)]);
    await client.query("COMMIT");
  } else await client.query("ROLLBACK");
  console.log(JSON.stringify(plan));
} catch(error) { await client.query("ROLLBACK").catch(()=>{}); console.error(error.message); process.exitCode=1; }
finally { await client.end(); }
