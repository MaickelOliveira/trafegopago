// Run after the encrypted pre-migration snapshot and before any worker starts.
import pg from 'pg';
import {planProviderRetirement} from './lib/retire-provider-plan.mjs';
const apply=process.argv.includes('--apply');
if(apply&&!process.argv.includes('--backup-verified'))throw Error('A desativação exige uma cópia de segurança verificada.');
const client=new pg.Client({connectionString:process.env.DATABASE_URL});
try{
 await client.connect();await client.query('BEGIN');await client.query('SELECT pg_advisory_xact_lock(721461,1)');
 const documents=(await client.query('SELECT name,payload FROM app_documents')).rows;
 const plan=planProviderRetirement(Object.fromEntries(documents.map(row=>[row.name,row.payload])));
 const active=[...plan.channels.keys()];
 const queues=(await client.query("SELECT collection,record_key,payload FROM app_records WHERE collection=ANY($1) AND status=ANY($2)",[['followups.json','pending-responses.json'],['pending','processing']])).rows.filter(row=>plan.channels.get(row.payload.connId)?.clientId!==row.payload.clientId);
 const result={dryRun:!apply,changedDocuments:plan.changed,counts:plan.counts,queuesRetired:queues.length,availableChannels:active.length,externalMessagesSent:false};
 if(apply&&(plan.changed.length||queues.length)){
  for(const name of plan.changed)await client.query('UPDATE app_documents SET payload=$2,revision=revision+1,updated_at=clock_timestamp() WHERE name=$1',[name,JSON.stringify(plan.files[name])]);
  for(const row of queues){row.payload.status=row.collection==='followups.json'?'cancelled':'done';row.payload.lastError='Conexão desativada. Item encerrado sem novo envio.';await client.query('UPDATE app_records SET payload=$3,revision=revision+1,updated_at=clock_timestamp() WHERE collection=$1 AND record_key=$2',[row.collection,row.record_key,JSON.stringify(row.payload)]);}
  const audit={at:new Date().toISOString(),...result,dryRun:false,retired:plan.retired};
  await client.query("INSERT INTO app_documents(name,payload) VALUES('provider-retirement-audit.json',$1) ON CONFLICT(name) DO UPDATE SET payload=EXCLUDED.payload,revision=app_documents.revision+1,updated_at=clock_timestamp()",[JSON.stringify(audit)]);
  await client.query('COMMIT');
 }else await client.query('ROLLBACK');
 console.log(JSON.stringify(result));
}catch(error){await client.query('ROLLBACK').catch(()=>{});console.error(error.message);process.exitCode=1;}finally{await client.end();}
