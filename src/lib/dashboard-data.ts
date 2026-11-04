export type DashboardInsights = {
  spend:number; impressions:number; clicks:number; ctr:number; cpm:number;
  reach?:number; leads:number; conversations:number; purchases:number;
  conversions:number; revenue:number;
};
export type DashboardCampaign = {id:string;name:string;status:string;insights:DashboardInsights|null};
export type DashboardDaily = {date:string;spend:number;clicks:number;impressions:number;reach?:number};
export type DashboardAccount = {id:string;platform:string};
export type DashboardCrmLead = {id:string;name:string;phone:string;realPhone?:string;status:string;funnelId:string;createdAt:string;updatedAt?:string;value?:number|null};
const number=(value:unknown)=>Number.isFinite(Number(value))?Number(value):0;
const object=(value:unknown):Record<string,unknown>=>value&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:{};

/** Keep Google conversions distinct from WhatsApp conversations and purchases. */
export function dashboardInsights(platform:string,value:unknown):DashboardInsights {
 const raw=object(value),spend=number(raw.spend),impressions=number(raw.impressions),clicks=number(raw.clicks);
 return {spend,impressions,clicks,ctr:impressions>0?clicks/impressions*100:0,cpm:impressions>0?spend/impressions*1000:0,
  ...(platform==="meta"?{reach:number(raw.reach)}:{}),leads:platform==="meta"?number(raw.leads):0,
  conversations:platform==="meta"?number(raw.conversations):0,purchases:platform==="meta"?number(raw.purchases):0,
  conversions:platform==="google"?number(raw.conversions):0,revenue:number(platform==="google"?raw.conversionsValue:raw.revenue)};
}
function campaigns(platform:string,value:unknown):DashboardCampaign[] {
 if(!Array.isArray(value))throw Error("Invalid campaigns response");
 return value.map(item=>{const row=object(item);return{id:String(row.id??""),name:String(row.name??""),status:String(row.status??"UNKNOWN"),insights:row.insights?dashboardInsights(platform,row.insights):null};});
}
function daily(value:unknown):DashboardDaily[]{
 if(!Array.isArray(value))throw Error("Invalid daily response");
 return value.map(item=>{const row=object(item);return{date:String(row.date??""),spend:number(row.spend),impressions:number(row.impressions),clicks:number(row.clicks),...(row.reach!=null?{reach:number(row.reach)}:{})};});
}
export async function loadDashboardData(account:DashboardAccount|undefined,clientId:string,datePreset:string,signal?:AbortSignal,request:typeof fetch=fetch){
 const read=async(url:string)=>{const response=await request(url,{signal});if(!response.ok)throw Error("Unavailable dashboard source");return response.json();};
 const supported=account&&(account.platform==="meta"||account.platform==="google");
 const base=supported?`/api/${account.platform==="google"?"google-ads":"meta"}/${encodeURIComponent(account.id)}`:null;
 const query=new URLSearchParams({datePreset}).toString();
 const [campaignResult,dailyResult,summaryResult,crmResult]=await Promise.allSettled([
  base?read(`${base}/campaigns?${query}`).then(value=>campaigns(account!.platform,value)):Promise.resolve([]),
  base?read(`${base}/insights?${query}&daily=1`).then(daily):Promise.resolve([]),
  base?read(`${base}/insights?${query}`).then(value=>{if(value!==null&&(!value||typeof value!=="object"||Array.isArray(value)||"error" in value))throw Error("Invalid summary response");return dashboardInsights(account!.platform,value);}):Promise.resolve(null),
  read(`/api/crm/leads?clientId=${encodeURIComponent(clientId)}`).then(value=>{if(!Array.isArray(value))throw Error("Invalid CRM response");return value as DashboardCrmLead[];}),
 ]);
 const adsError=!base?"Conecte uma conta da Meta ou do Google para consultar os indicadores.":[campaignResult,dailyResult,summaryResult].some(result=>result.status==="rejected")?"Não foi possível atualizar todos os dados de anúncios. Confira a conexão e tente novamente.":null;
 return {campaigns:campaignResult.status==="fulfilled"?campaignResult.value:[],daily:dailyResult.status==="fulfilled"?dailyResult.value:[],
  summary:summaryResult.status==="fulfilled"?summaryResult.value:null,adsError,
  crmLeads:crmResult.status==="fulfilled"?crmResult.value:[],crmError:crmResult.status==="rejected"?"Não foi possível atualizar os indicadores do CRM.":null};
}
