// Read-only provider inventory. Never starts/closes a session or sends a message.
// Run inside the existing application container so its current env is inherited.
import { readFile } from "node:fs/promises";
import path from "node:path";
const directory=path.resolve(process.env.LEGACY_DATA_DIR||"data");
async function read(name,fallback){try{return JSON.parse(await readFile(path.join(directory,name),"utf8"));}catch(error){if(error.code==='ENOENT')return fallback;throw error;}}
const config=await read('config.json',{}),funnels=await read('funnels.json',[]),evolution=await read('evolution-sessions.json',[]);
async function get(url,headers){try{const r=await fetch(url,{headers,signal:AbortSignal.timeout(8000)});if(!r.ok)return {available:false,http:r.status};return {available:true,data:await r.json()};}catch{return {available:false};}}
const results=[];
for(const session of evolution){
 const base=(process.env.EVOLUTION_SERVER||config.evolutionServer||'').replace(/\/$/,''),headers={apikey:process.env.EVOLUTION_ADMIN_KEY||config.evolutionAdminKey||session.instanceApiKey||''};
 if(!base){results.push({provider:'evolution',configured:false});continue;}
 const status=await get(base+'/instance/connectionState/'+encodeURIComponent(session.instanceName),headers),hook=await get(base+'/webhook/find/'+encodeURIComponent(session.instanceName),headers);
 const state=String(status.data?.instance?.state||status.data?.state||'unknown').toLowerCase();
 results.push({provider:'evolution',configured:true,available:status.available,connected:['open','connected'].includes(state),webhookReadable:hook.available,webhookShape:hook.data?Object.keys(hook.data):null});
}
console.log(JSON.stringify({readOnly:true,authSecretAtLeast32:!!process.env.JWT_SECRET&&process.env.JWT_SECRET.length>=32,results,externalMessagesSent:false}));
