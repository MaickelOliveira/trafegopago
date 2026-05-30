import { NextRequest, NextResponse } from "next/server";
import { getFunnels } from "@/lib/funnels";
import { sendText, sendMedia } from "@/lib/uazapi";
import { sendMessageDirect } from "@/lib/whatsapp-send";
import { sendText as wppSendText } from "@/lib/wppconnect-api";
import { getWppSessions } from "@/lib/wppconnect-sessions";
import { addMessage, setAiPaused } from "@/lib/conversations";
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
  const wppSession = connId
    ? getWppSessions().find((s) => s.id === connId && s.clientId === clientId)
    : undefined;

  if (!conn && !wppSession) {
    return NextResponse.json({ error: "Nenhuma conexão encontrada para este cliente" }, { status: 404 });
  }

  let ok = false;
  const ts = Date.now();

  // ── WPPConnect ──
  if (wppSession) {
    if (type === "text") {
      ok = await wppSendText(wppSession.sessionName, wppSession.sessionToken, cleanPhone, content);
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
    addMessage(cleanPhone, { role: "assistant", content: type === "text" ? content : `[${type}]`, ts, type: type === "video" ? undefined : type }, clientId, { connId: activeConnId });
    // Pausa a IA nos dois storages
    setAiPaused(cleanPhone, true);
    // Busca o lead real pelo telefone (sem depender de funnelId) e atualiza
    const existingLead = getLeadByPhone(clientId, cleanPhone);
    if (existingLead) updateLead(existingLead.id, { aiPaused: true });
  }

  return NextResponse.json({ ok });
}
