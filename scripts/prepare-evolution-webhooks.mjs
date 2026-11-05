// Adds authentication to existing callbacks, preserving sessions and filters.
// Dry-run by default. Does not call connect/logout/start/send endpoints.
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createHmac, randomUUID } from "node:crypto";
import path from "node:path";
const directory=path.resolve(process.env.LEGACY_DATA_DIR||'data');
const config=JSON.parse(await readFile(path.join(directory,'config.json'),'utf8'));
const sessions=JSON.parse(await readFile(path.join(directory,'evolution-sessions.json'),'utf8'));
const base=(process.env.EVOLUTION_SERVER||config.evolutionServer||'').replace(/\/$/,'');
const app=new URL(process.env.APP_BASE_URL||config.appBaseUrl);
const key=process.env.JWT_SECRET;
if(!base||!key||key.length<32)throw Error('Configuração de retorno incompleta.');
const headers={apikey:process.env.EVOLUTION_ADMIN_KEY||config.evolutionAdminKey};
const apply=process.argv.includes('--apply'),before=[],results=[];
const backupName='evolution-webhooks-before-'+randomUUID()+'.json';
async function request(route,options={}){const response=await fetch(base+route,{...options,headers:{...headers,...options.headers},signal:AbortSignal.timeout(10000)});if(!response.ok)throw Error('O provedor não confirmou a configuração.');return response.json();}
for(const session of sessions){
 const name=encodeURIComponent(session.instanceName);
 const route='/webhook/find/'+name,current=await request(route),state=await request('/instance/connectionState/'+name);
 if(!current.url){results.push({configured:false,changed:false});continue;}
 const url=new URL(current.url);
 if(url.origin!==app.origin||url.pathname!==`/api/whatsapp/webhook/evolution/${session.id}`)throw Error('Um destino precisa de revisão manual; nenhuma sessão será reiniciada.');
 const oldState=String(state.instance?.state||state.state||'').toLowerCase();
 const signature=createHmac('sha256',key).update('webhook:'+url.pathname).digest('hex');
 if(url.searchParams.get('signature')===signature){results.push({configured:true,alreadySigned:true,changed:false});continue;}
 before.push({sessionId:session.id,instanceName:session.instanceName,webhook:current});
 url.searchParams.set('signature',signature);
 if(apply){
  // Save the original settings before the first mutation, including prior
  // entries, so a partially failed run still has a recovery artifact.
  const backup=path.join(directory,'audit-backups');await mkdir(backup,{recursive:true,mode:0o700});
  await writeFile(path.join(backup,backupName),JSON.stringify(before),{mode:0o600});
  const webhook={url:url.toString(),enabled:current.enabled,events:current.events,webhookByEvents:current.webhookByEvents,webhookBase64:current.webhookBase64,...(current.headers?{headers:current.headers}:{})};
  await request('/webhook/set/'+name,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({webhook})});
  const verified=await request(route),after=await request('/instance/connectionState/'+name);
  if(verified.url!==url.toString()||String(after.instance?.state||after.state||'').toLowerCase()!==oldState)throw Error('A verificação do retorno ou da conexão falhou.');
 }
 results.push({configured:true,changed:apply,wouldChange:!apply,connectionPreserved:true});
}
console.log(JSON.stringify({dryRun:!apply,results,externalMessagesSent:false,sessionsRestarted:false}));
