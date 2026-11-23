/** Pure transformation: conversations, leads, prompts and completed jobs remain unchanged. */
export function planProviderRetirement(input) {
 const files=structuredClone(input),counts={credentials:0,connections:0,sessions:0,agents:0,automations:0,jobs:0},retired=[];
 const funnels=files['funnels.json']||[],owners=new Map(funnels.map(f=>[f.id,f.clientId]));
 const channels=new Map();
 for(const funnel of funnels){funnel.connections=(funnel.connections||[]).filter(connection=>{if(connection.type==='meta'){if(funnel.clientId)channels.set(connection.id,{clientId:funnel.clientId,funnelId:funnel.id});return true;}counts.connections++;retired.push({id:connection.id,clientId:funnel.clientId,funnelId:funnel.id,provider:connection.type});return false;});}
 for(const session of files['evolution-sessions.json']||[]){const clientId=owners.get(session.funnelId);if(clientId&&(!session.clientId||session.clientId===clientId))channels.set(session.id,{clientId,funnelId:session.funnelId});}
 for(const name of ['wppconnect-sessions.json','server-whatsapp-sessions.json','extension-devices.json']){
  for(const item of files[name]||[]){counts.sessions++;retired.push({id:item.id,clientId:item.clientId,funnelId:item.funnelId,provider:name.replace('.json','')});}
  if(name in files)files[name]=[];
 }
 for(const name of ['wpp-share-links.json','extension-pairing-codes.json','extension-outbox.json'])if(name in files)files[name]=[];
 const config=files['config.json']||{};
 for(const key of ['uazapiServer','uazapiToken','uazapiAdminToken','uazapiWebhookForward','wppconnectServer','wppconnectSecretKey'])if(key in config){delete config[key];counts.credentials++;}
 if(config.masterConnectionId&&!channels.has(config.masterConnectionId)){delete config.masterConnectionId;counts.credentials++;}
 const valid=(id,clientId)=>!!id&&channels.get(id)?.clientId===clientId;
 for(const client of files['clients.json']?.clients||[]){
  for(const agent of [client.agentConfig,...(client.agentConfigs||[])].filter(Boolean)){
   if(valid(agent.whatsappConnectionId,client.id))continue;
   if(agent.enabled||agent.followUpEnabled){agent.enabled=false;agent.followUpEnabled=false;agent.connectionNeedsSetup=true;counts.agents++;}
  }
 }
 const disabled=new Set();
 for(const automation of files['crm-automations.json']||[]){
  const ids=[automation.connectionId,...(automation.steps||[]).filter(step=>['send_message','send_list','send_template'].includes(step.type)).map(step=>step.connectionId)].filter(Boolean);
  if(ids.some(id=>!valid(id,automation.clientId))){disabled.add(automation.id);if(automation.active){automation.active=false;automation.disabledReason='Conexão desativada. Vincule Evolution ou API oficial antes de reativar.';counts.automations++;}}
 }
 for(const job of files['crm-automation-jobs.json']||[])if(disabled.has(job.automationId)&&['pending','processing'].includes(job.status)){job.status='cancelled';job.lastError='Conexão desativada por solicitação do responsável.';counts.jobs++;}
 return {files,channels,counts,retired,changed:Object.keys(files).filter(name=>JSON.stringify(input[name])!==JSON.stringify(files[name]))};
}
