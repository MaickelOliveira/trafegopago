import { NextRequest,NextResponse } from "next/server";
import { sendManualWhatsApp } from "@/lib/manual-whatsapp-send";
import { normalizePhone } from "@/lib/leads";
export const dynamic="force-dynamic";
export async function POST(request:NextRequest){
 const body=await request.json();
 const {phone,content,clientId,connId,caption}=body;
 const type=body.type??"text";
 if(![phone,content,clientId,connId].every(value=>typeof value==="string"&&value.trim())||!['text','audio','image','video','document'].includes(type)||content.length>100000) return NextResponse.json({error:"Informe o cliente, a conversa e a mensagem."},{status:400});
 try{const ok=await sendManualWhatsApp(request,{phone:phone.endsWith("@lid")?phone:normalizePhone(phone),content,clientId,connId,caption,type});return NextResponse.json({ok,error:ok?undefined:"O provedor não confirmou o envio. Confira a conexão antes de tentar novamente."},{status:ok?200:502});}
 catch(error){return NextResponse.json({ok:false,error:error instanceof Error?error.message:"Não foi possível enviar."},{status:422});}
}
