import { NextRequest, NextResponse } from "next/server";
import { getFunnels } from "@/lib/funnels";
import { sendText, sendMedia } from "@/lib/uazapi";
import { sendMessageDirect } from "@/lib/whatsapp-send";
import { sendText as wppSendText } from "@/lib/wppconnect-api";
import { getWppSessions } from "@/lib/wppconnect-sessions";
import { addMessage, setAiPaused } from "@/lib/conversations";
import { markSent } from "@/lib/wppconnect-sent";
import { getLeadByPhone, updateLead } from "@/lib/leads";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const { phone, content, type = "text", clientId, connId, caption } = await req.json() as {
    phone: string;
    content: string;
    type?: "text" | "audio" | "image" | "video";
    clientId: string;
    connId?: string;
    caption?: string;
  };

  if (!phone || !content || !clientId) {
    return NextResponse.json({ error: "phone, content, clientId required" }, { status: 400 });
  }

  const cleanPhone = phone.replace(/\D/g, "");

  // Encontra a conexão certa dentro dos funnels do cliente
  const funnels = getFunnels().filter((f) => f.clientId === clientId);
  const allConns = funnels.flatMap((f) => f.connections ?? []);

  // Preferência: usar o connId da conversa (o número que recebeu)
  const conn = connId
    ? allConns.find((c) => c.id === connId)
    : allConns[0]; // fallback para primeira conexão disponível

  // ── WPPConnect: sessões ficam em store separado (não em funnels[].connections) ──
  // Busca apenas pelo connId (UUID único) — clientId pode estar null no store
  const wppSession = connId
    ? getWppSessions().find((s) => s.id === connId)
    : undefined;

  console.log(`[inbox/send] phone=${cleanPhone} connId=${connId} clientId=${clientId} conn=${conn?.type} wppSession=${wppSession?.sessionName ?? "none"}`);

  if (!conn && !wppSession) {
    console.log(`[inbox/send] ERRO: nenhuma conexão encontrada. allConns=${JSON.stringify(allConns.map(c=>c.id))} wppSessions=${JSON.stringify(getWppSessions().map(s=>s.id))}`);
    return NextResponse.json({ error: "Nenhuma conexão encontrada para este cliente" }, { status: 404 });
  }

  let ok = false;
  const ts = Date.now();

  // ── WPPConnect ──
  if (wppSession) {
    if (type === "text") {
      const existingLeadForLid = getLeadByPhone(clientId, cleanPhone);
      let isLid = existingLeadForLid?.isLid === true;
      ok = await wppSendText(wppSession.sessionName, wppSession.sessionToken, cleanPhone, content, isLid);
      // Fallback: se falhou e ainda não tentamos com isLid, tenta com isLid:true
      if (!ok && !isLid) {
        console.log(`[inbox/send] Retrying with isLid=true phone=${cleanPhone}`);
        ok = await wppSendText(wppSession.sessionName, wppSession.sessionToken, cleanPhone, content, true);
        if (ok && existingLeadForLid) {
          updateLead(existingLeadForLid.id, { isLid: true });
          isLid = true;
        }
      }
      console.log(`[inbox/send] WPPConnect send ok=${ok} session=${wppSession.sessionName} phone=${cleanPhone} isLid=${isLid}`);
    } else {
      return NextResponse.json({ error: "Tipo de mídia não suportado via WPPConnect ainda" }, { status: 400 });
    }
  } else if (conn?.type === "meta" && conn.metaPhoneNumberId && conn.metaToken) {
    if (type === "text") {
      ok = await sendMessageDirect(cleanPhone, content, conn.metaPhoneNumberId, conn.metaToken);
    } else {
      // Meta não suporta áudio via base64, seria necessário upload separado
      return NextResponse.json({ error: "Tipo de mídia não suportado via Meta API ainda" }, { status: 400 });
    }
  } else if (conn?.type === "uazapi" && conn.uazapiToken) {
    if (type === "text") {
      ok = await sendText(conn.uazapiToken, cleanPhone, content);
    } else {
      ok = await sendMedia(conn.uazapiToken, cleanPhone, type as "audio" | "image" | "video", content, caption);
    }
  }

  if (ok) {
    // Salva no histórico como mensagem do assistente
    const activeConnId = wppSession?.id ?? conn?.id ?? connId ?? "";
    const savedContent = type === "text" ? content : `[${type}]`;
    markSent(cleanPhone, savedContent); // evita duplicidade no onselfmessage
    addMessage(cleanPhone, { role: "assistant", content: savedContent, ts, type: type === "video" ? undefined : type }, clientId, { connId: activeConnId });
    // Pausa a IA nos dois storages
    setAiPaused(cleanPhone, true);
    // Busca o lead real pelo telefone (sem depender de funnelId) e atualiza
    const existingLead = getLeadByPhone(clientId, cleanPhone);
    if (existingLead) updateLead(existingLead.id, { aiPaused: true });
  }

  return NextResponse.json({ ok });
}
