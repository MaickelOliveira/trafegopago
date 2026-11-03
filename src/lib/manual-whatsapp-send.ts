import { NextRequest } from "next/server";
import { getFunnelForConnection, getLeadForConnection } from "./lead-context";
import { getClientById, getAgentConfigForConnection } from "./clients";
import { sendMessage, sendMediaMessage } from "./whatsapp-send";
import { canReadMedia } from "./media-access";
import { addMessage, setAiPaused } from "./conversations";
import { updateLead, LeadIdentityConflict } from "./leads";
import { cancelPendingForPhone } from "./pending-responses";
import { cancelFollowUpsForPhone } from "./followups";

export async function assertManualMediaAccess(request:NextRequest,value:string):Promise<void> {
  if (value.startsWith("data:")) throw Error("Envie o arquivo antes de anexá-lo à mensagem.");
  const url=new URL(value,request.nextUrl.origin);
  if (/^\/api\/(?:media|uploads)\/[^/]+$/.test(url.pathname)) {
    url.search="";
    if (!await canReadMedia(new NextRequest(url,{headers:request.headers}))) throw Error("Este arquivo não pertence à sua conta.");
  }
}
export async function sendManualWhatsApp(request:NextRequest,input:{phone:string;clientId:string;connId:string;content:string;type?:"text"|"audio"|"image"|"video"|"document";caption?:string}):Promise<boolean> {
  if (!await getFunnelForConnection(input.clientId,input.connId)) throw Error("Selecione uma conexão deste cliente.");
  const type=input.type??"text";
  if(type!=="text") await assertManualMediaAccess(request,input.content);
  let lead;
  try { lead=await getLeadForConnection(input.clientId,input.phone,input.connId); } catch(error) { if(!(error instanceof LeadIdentityConflict))throw error; }
  const client=await getClientById(input.clientId);
  const keyword=client&&getAgentConfigForConnection(client,input.connId)?.aiResumeKeyword?.trim();
  const resume=type==="text"&&!!keyword&&input.content.trim().toLowerCase()===keyword.toLowerCase();
  // Take over before network I/O so queued AI work observes the manual pause.
  await setAiPaused(input.phone,true,input.clientId,input.connId);
  if(lead)await updateLead(lead.id,{aiPaused:true});
  await cancelPendingForPhone(input.clientId,input.phone,input.connId);
  await cancelFollowUpsForPhone(input.clientId,input.phone,input.connId);
  const ok=type==="text"?await sendMessage(input.phone,input.content,input.clientId,input.connId):await sendMediaMessage(input.phone,input.content,input.clientId,input.caption,input.connId,type).then(()=>true);
  if(!ok)return false;
  await addMessage(input.phone,{role:"assistant",content:type==="text"?input.content:(input.caption||`[${type}]`),ts:Date.now(),...(type!=="text"?{mediaUrl:input.content}:{}),...(type==="audio"||type==="image"?{type}:{})},input.clientId,{connId:input.connId});
  if(resume){await setAiPaused(input.phone,false,input.clientId,input.connId);if(lead)await updateLead(lead.id,{aiPaused:false});}
  return true;
}
