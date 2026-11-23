import { resolveConversationChannel } from "@/lib/conversation-channel";
import { NextRequest,NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getHistory,getAllConversationsByClientId } from "@/lib/conversations";
import { sendManualWhatsApp } from "@/lib/manual-whatsapp-send";
import { normalizePhone } from "@/lib/leads";
type Params=Promise<{phone:string}>;
export const dynamic="force-dynamic";
export async function GET(req: NextRequest, { params }: { params: Params }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  const { phone } = await params;
  const clientId = req.nextUrl.searchParams.get("clientId") || session.clientId;
  if (!clientId || session.role !== "manager" && session.clientId !== clientId) return NextResponse.json({ error: "Cliente obrigatório." }, { status: 403 });
  const funnelId = req.nextUrl.searchParams.get("funnelId") || undefined;
  const requested = req.nextUrl.searchParams.get("connId") || undefined;
  const connId = await resolveConversationChannel(clientId, phone, funnelId, requested);
  if (!connId) {
    if (requested && session.role !== "employee" && (await getAllConversationsByClientId(clientId)).some(conversation => conversation.connId === requested)) return NextResponse.json({ messages: await getHistory(phone, clientId, requested), connId: requested });
    return NextResponse.json({ messages: [], connId: null, needsConnection: true });
  }
  return NextResponse.json({ messages: await getHistory(phone, clientId, connId), connId });
}

export async function POST(request:NextRequest,{params}:{params:Params}){
 const session=await getSession();if(!session)return NextResponse.json({error:"Entre na sua conta."},{status:401});
 const {phone}=await params,body=await request.json();
 const clientId=body.clientId||session.clientId;
 if(!clientId||session.role!=="manager"&&session.clientId!==clientId)return NextResponse.json({error:"Informe o cliente."},{status:403});
 const message=typeof body.message==="string"?body.message.trim():"",imageUrl=typeof body.imageUrl==="string"?body.imageUrl.trim():"";
 if((!message&&!imageUrl)||message.length>100000)return NextResponse.json({error:"Informe a mensagem."},{status:400});
 const connId=await resolveConversationChannel(clientId,phone,body.funnelId,body.connId);
 if(!connId)return NextResponse.json({error:"Selecione a conexão desta conversa."},{status:422});
 try{const ok=await sendManualWhatsApp(request,{phone:phone.endsWith("@lid")?phone:normalizePhone(phone),clientId,connId,content:imageUrl||message,type:imageUrl?"image":"text",caption:imageUrl?message:undefined});return NextResponse.json({ok,error:ok?undefined:"O provedor não confirmou o envio. Confira a conexão antes de tentar novamente."},{status:ok?200:502});}
 catch(error){return NextResponse.json({ok:false,error:error instanceof Error?error.message:"Não foi possível enviar."},{status:422});}
}
