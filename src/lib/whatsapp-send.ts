import { getFunnels } from "./funnels";
import { getConfig } from "./clients";
import { getEvolutionSessions } from "./evolution-sessions";
import { sendText as evoSendText,sendMedia as evoSendMedia } from "./evolution-api";
import { signMediaUrl } from "./media-access";
import { getFunnelForConnection } from "./lead-context";

export async function sendMessage(phone:string,message:string,clientId:string,preferredConnectionId?:string):Promise<boolean>{
 const funnels=(await getFunnels()).filter(funnel=>funnel.clientId===clientId);
 const official=funnels.flatMap(funnel=>(funnel.connections??[]).filter(connection=>connection.type==="meta"));
 const evolution=(await getEvolutionSessions()).filter(session=>(!session.clientId||session.clientId===clientId)&&funnels.some(funnel=>funnel.id===session.funnelId));
 const ids=[...official.map(connection=>connection.id),...evolution.map(session=>session.id)];
 const selected=preferredConnectionId||(ids.length===1?ids[0]:undefined);
 if(!selected||!await getFunnelForConnection(clientId,selected))return false;
 const session=evolution.find(item=>item.id===selected);
 if(session){const raw=phone.replace(/@.*$/,"").replace(/\D/g,"");return evoSendText(session.instanceName,session.instanceApiKey,phone,message,phone.endsWith("@lid")||(raw.length>=13&&!raw.startsWith("55")),true);}
 const connection=official.find(item=>item.id===selected);
 return !!connection?.metaPhoneNumberId&&!!connection.metaToken&&sendMessageDirect(phone,message,connection.metaPhoneNumberId,connection.metaToken);
}

export async function sendMessageDirect(
  phone: string,
  message: string,
  phoneNumberId: string,
  accessToken: string
): Promise<boolean> {
  try {
    const res = await fetch(
      `https://graph.facebook.com/v26.0/${phoneNumberId}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        signal: AbortSignal.timeout(20000),
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: phone,
          type: "text",
          text: { body: message },
        }),
      }
    );
    const bodyText = await res.text().catch(() => "");
    let data: { error?: { message?: string } } | null = null;
    try { data = bodyText ? JSON.parse(bodyText) : null; } catch { /* corpo não-JSON */ }
    // Mesmo com status 2xx, a Graph API pode retornar um objeto "error" no corpo
    // (ex: janela de 24h fechada) — sem checar isso, marcávamos como enviado indevidamente.
    const ok = res.ok && !data?.error;
    if (!ok) {
      console.error(`[sendMessageDirect] FALHOU status=${res.status} phoneNumberId=${phoneNumberId} `);
    }
    return ok;
  } catch (e) {
    console.error(`[sendMessageDirect] EXCEÇÃO phoneNumberId=${phoneNumberId} `, e);
    return false;
  }
}

/**
 * Baixa um arquivo de mídia (áudio/imagem/documento/vídeo) recebido via Meta
 * Cloud API. Diferente do WPPConnect/UazAPI, a Graph API já entrega o arquivo
 * descriptografado — só precisa do media id (2 chamadas: pega a URL temporária,
 * depois baixa o conteúdo, ambas autenticadas com o token da conexão).
 */
export async function downloadMetaMedia(mediaId: string, accessToken: string): Promise<Buffer | null> {
  try {
    const metaRes = await fetch(`https://graph.facebook.com/v26.0/${mediaId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (!metaRes.ok) {
      console.error(`[downloadMetaMedia] HTTP ${metaRes.status} ao buscar metadata do media id=${mediaId}`);
      return null;
    }
    const { url } = await metaRes.json() as { url?: string };
    if (!url) return null;

    const fileRes = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(30_000),
    });
    if (!fileRes.ok) {
      console.error(`[downloadMetaMedia] HTTP ${fileRes.status} ao baixar arquivo do media id=${mediaId}`);
      return null;
    }
    return Buffer.from(await fileRes.arrayBuffer());
  } catch (e) {
    console.error(`[downloadMetaMedia] EXCEÇÃO media id=${mediaId}:`, e instanceof Error ? e.message : e);
    return null;
  }
}

export async function getGeminiApiKey(clientGeminiKey?: string): Promise<string | null> {
  const config = (await getConfig());
  return (
    clientGeminiKey ||
    config.geminiApiKey ||
    process.env.GEMINI_API_KEY ||
    process.env.GOOGLE_IMAGEN_API_KEY ||
    null
  );
}


export async function sendMediaMessage(phone:string,mediaUrl:string,clientId:string,caption?:string,preferredConnectionId?:string,mediaType?:"image"|"video"|"audio"|"document"):Promise<void>{
 if(!preferredConnectionId||!await getFunnelForConnection(clientId,preferredConnectionId))throw Error("Selecione uma conexão deste cliente.");
 const evolution=(await getEvolutionSessions()).find(session=>session.id===preferredConnectionId);
 const raw=phone.replace(/@.*$/," ").replace(/\D/g,"");
 if(evolution){if(!await evoSendMedia(evolution.instanceName,evolution.instanceApiKey,phone,mediaUrl,caption,raw.length>=13&&!raw.startsWith("55"),true))throw Error("O provedor não confirmou o envio.");return;}
 const official=(await getFunnels()).filter(funnel=>funnel.clientId===clientId).flatMap(funnel=>funnel.connections??[]).find(connection=>connection.type==="meta"&&connection.id===preferredConnectionId);
 if(!official?.metaPhoneNumberId||!official.metaToken)throw Error("Configure a conexão oficial.");
 const link=await signMediaUrl(mediaUrl),url=new URL(link);if(url.protocol!=="https:")throw Error("Use um arquivo com endereço HTTPS.");
 const ext=url.pathname.split(".").pop()?.toLowerCase(),type=mediaType||(["jpg","jpeg","png","gif","webp"].includes(ext||"")?"image":["mp4","mov"].includes(ext||"")?"video":["mp3","ogg","wav","m4a"].includes(ext||"")?"audio":"document");
 const response=await fetch(`https://graph.facebook.com/v26.0/${official.metaPhoneNumberId}/messages`,{method:"POST",headers:{Authorization:`Bearer ${official.metaToken}`,"Content-Type":"application/json"},body:JSON.stringify({messaging_product:"whatsapp",to:phone,type,[type]:{link,...(caption&&type!=="audio"?{caption}:{})}}),signal:AbortSignal.timeout(20000)});
 const data=await response.json();if(!response.ok||data.error)throw Error("A API oficial não confirmou o envio da mídia.");
}

/** Provider-native lists; only explicitly owned channels can send. */
export async function sendInteractiveList(phone:string,clientId:string,connectionId:string,title:string,button:string,rows:{id:string;title:string;description?:string}[]):Promise<boolean>{
 if(!await getFunnelForConnection(clientId,connectionId)||!rows.length||rows.length>10||!title||title.length>1024||button.length>20||rows.some(row=>!row.id||!row.title||row.title.length>24||row.id.length>200||(row.description?.length??0)>72)||new Set(rows.map(row=>row.id)).size!==rows.length)return false;
 const session=(await getEvolutionSessions()).find(item=>item.id===connectionId);
 if(session){const {sendList}=await import("./evolution-api");return sendList(session.instanceName,session.instanceApiKey,phone,title,button,rows);}
 const connection=(await getFunnels()).filter(f=>f.clientId===clientId).flatMap(f=>f.connections??[]).find(c=>c.id===connectionId&&c.type==="meta");
 if(!connection?.metaPhoneNumberId||!connection.metaToken)return false;
 try{const response=await fetch(`https://graph.facebook.com/v26.0/${connection.metaPhoneNumberId}/messages`,{method:"POST",headers:{Authorization:`Bearer ${connection.metaToken}`,"Content-Type":"application/json"},body:JSON.stringify({messaging_product:"whatsapp",to:phone,type:"interactive",interactive:{type:"list",body:{text:title},action:{button,sections:[{rows}]}}}),signal:AbortSignal.timeout(20000)});const data=await response.json();return response.ok&&!data.error;}catch{return false;}
}
