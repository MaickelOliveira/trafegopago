import {getConfig} from "./clients";
import {getFunnels} from "./funnels";
import {getEvolutionSessions} from "./evolution-sessions";
import {getFunnelForConnection} from "./lead-context";
import {sendMessage} from "./whatsapp-send";
import {sendTemplate} from "./waba-templates";
import {addMessage} from "./conversations";
type MetaOverride={templateName?:string;language?:string;components?:object[]};
export async function sendMasterNotification(message:string,metaOverride?:MetaOverride):Promise<boolean>{
 const config=await getConfig(),phone=config.masterPhone?.replace(/\D/g,""),id=config.masterConnectionId;
 if(!phone||!id)return false;
 const funnels=await getFunnels(),official=funnels.find(funnel=>funnel.connections?.some(connection=>connection.id===id&&connection.type==="meta"));
 const evolution=(await getEvolutionSessions()).find(session=>session.id===id);
 const funnel=official||funnels.find(item=>item.id===evolution?.funnelId);
 if(!funnel?.clientId||!await getFunnelForConnection(funnel.clientId,id))return false;
 let ok=false;
 if(official){const connection=official.connections!.find(item=>item.id===id)!;const name=metaOverride?.templateName||config.masterMetaTemplateBriefing;if(!name||!connection.metaPhoneNumberId||!connection.metaToken)return false;ok=(await sendTemplate(connection.metaPhoneNumberId,connection.metaToken,phone,name,metaOverride?.language||config.masterMetaLanguage||"pt_BR",metaOverride?.components)).success;}
 else ok=await sendMessage(phone,message,funnel.clientId,id);
 if(ok)await addMessage(phone,{role:"assistant",content:message,ts:Date.now()},funnel.clientId,{connId:id});
 return ok;
}
