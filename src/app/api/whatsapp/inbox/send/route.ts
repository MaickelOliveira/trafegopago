import { NextRequest, NextResponse } from "next/server";
import { getFunnels } from "@/lib/funnels";
import { sendText, sendMedia } from "@/lib/uazapi";
import { sendMessageDirect } from "@/lib/whatsapp-send";
import { sendText as wppSendText } from "@/lib/wppconnect-api";
import { getWppSessions } from "@/lib/wppconnect-sessions";
import { sendText as evoSendText } from "@/lib/evolution-api";
import { getEvolutionSessions } from "@/lib/evolution-sessions";
import { addMessage, setAiPaused } from "@/lib/conversations";
import { markSent } from "@/lib/wppconnect-sent";
import { getLeadByPhone, updateLead } from "@/lib/leads";
import { cancelPendingForPhone } from "@/lib/pending-responses";
import { getServerWhatsAppSessions } from "@/lib/server-whatsapp-sessions";
import { sendServerWhatsAppText } from "@/lib/server-whatsapp-api";
import { getDeviceById } from "@/lib/extension-devices";
import { queueReply } from "@/lib/extension-outbox";

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

  const digits = phone.replace(/\D/g, "");
  const cleanPhone = digits.startsWith("55") ? digits : "55" + digits;

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
  const serverSession = connId
    ? getServerWhatsAppSessions().find((s) => s.id === connId && s.clientId === clientId)
    : getServerWhatsAppSessions().find((s) => s.clientId === clientId);
  // ── Extensão Chrome: dispositivo vive em store separado (extension-devices.json),
  // não em funnels[].connections nem nas outras sessões acima — mesmo ponto cego
  // já corrigido em connection-metrics.ts / inbox/conversations/route.ts.
  const extDeviceRaw = connId ? getDeviceById(connId) : undefined;
  const extDevice = extDeviceRaw?.clientId === clientId ? extDeviceRaw : undefined;
  // ── Evolution API: instâncias também vivem em store separado
  // (evolution-sessions.json), não em funnels[].connections — mesmo padrão
  // do WPPConnect acima. Sem isso, um cliente conectado só via Evolution
  // (sem nenhuma connection dentro do funil) nunca achava conexão nenhuma.
  const evoSessionRaw = connId ? getEvolutionSessions().find((s) => s.id === connId) : undefined;
  const evoSession = evoSessionRaw && (evoSessionRaw.clientId === null || evoSessionRaw.clientId === clientId) ? evoSessionRaw : undefined;

  console.log(`[inbox/send] phone=${cleanPhone} connId=${connId} clientId=${clientId} conn=${conn?.type} wppSession=${wppSession?.sessionName ?? "none"} extDevice=${extDevice?.id ?? "none"} evoSession=${evoSession?.instanceName ?? "none"}`);

  if (!conn && !wppSession && !serverSession && !extDevice && !evoSession) {
    console.log(`[inbox/send] ERRO: nenhuma conexão encontrada. allConns=${JSON.stringify(allConns.map(c=>c.id))} wppSessions=${JSON.stringify(getWppSessions().map(s=>s.id))}`);
    return NextResponse.json({ error: "Nenhuma conexão encontrada para este cliente" }, { status: 404 });
  }

  let ok = false;
  let errorMsg: string | undefined;
  const ts = Date.now();

  // ── WPPConnect ──
  if (serverSession) {
    if (type !== "text") {
      return NextResponse.json({ error: "Essa conexão no servidor suporta somente texto por enquanto" }, { status: 400 });
    }
    ok = await sendServerWhatsAppText(serverSession.id, cleanPhone, content);
    if (!ok) errorMsg = "Falha ao enviar pela conexão do servidor (sessão desconectada?)";
  } else if (wppSession) {
    if (type === "text") {
      const existingLeadForLid = getLeadByPhone(clientId, cleanPhone);
      let isLid = existingLeadForLid?.isLid === true;
      markSent(cleanPhone, content); // marca ANTES de enviar (evita race condition com onselfmessage)
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
      if (!ok) errorMsg = "Falha ao enviar via WPPConnect (sessão desconectada — escaneie o QR Code novamente)";
    } else {
      return NextResponse.json({ error: "Tipo de mídia não suportado via WPPConnect ainda" }, { status: 400 });
    }
  } else if (evoSession) {
    if (type === "text") {
      const existingLeadForLid = getLeadByPhone(clientId, cleanPhone);
      let isLid = existingLeadForLid?.isLid === true;
      ok = await evoSendText(evoSession.instanceName, evoSession.instanceApiKey, cleanPhone, content, isLid);
      // Fallback: se falhou e ainda não tentamos com isLid, tenta com isLid:true
      if (!ok && !isLid) {
        console.log(`[inbox/send] Retrying Evolution with isLid=true phone=${cleanPhone}`);
        ok = await evoSendText(evoSession.instanceName, evoSession.instanceApiKey, cleanPhone, content, true);
        if (ok && existingLeadForLid) {
          updateLead(existingLeadForLid.id, { isLid: true });
          isLid = true;
        }
      }
      if (!ok) errorMsg = "Falha ao enviar via Evolution API (instância desconectada?)";
    } else {
      return NextResponse.json({ error: "Tipo de mídia não suportado via Evolution ainda" }, { status: 400 });
    }
  } else if (extDevice) {
    if (type !== "text") {
      return NextResponse.json({ error: "Essa conexão (extensão do WhatsApp Web) suporta somente texto por enquanto" }, { status: 400 });
    }
    // Não há chatId persistido pra esse contato fora do fluxo de resposta
    // automática (maybeGenerateAiReply em whatsapp-extension/messages/route.ts
    // usa item.chatId, vindo da própria mensagem recebida) — construir "@c.us"
    // cobre o caso comum. Contato puro LID pode precisar de endereçamento
    // diferente, mesmo problema do isLid tratado acima pro WPPConnect.
    // markSent ANTES de enfileirar, mesmo padrão da branch wppSession acima —
    // sem isso, quando a extensão entrega essa mensagem via wa-js e o
    // WhatsApp Web ecoa como fromMe, whatsapp-extension/messages/route.ts
    // não reconhece o eco (isPhoneSending/consumeSent) e grava a mensagem
    // duplicada no histórico + pausa a IA de novo.
    markSent(cleanPhone, content);
    queueReply(extDevice.id, `${cleanPhone}@c.us`, cleanPhone, content);
    ok = true; // enfileirado — a extensão entrega por polling (~5s, ver extension/src/content-script.ts), sem confirmação síncrona aqui
  } else if (conn?.type === "meta" && conn.metaPhoneNumberId && conn.metaToken) {
    if (type === "text") {
      ok = await sendMessageDirect(cleanPhone, content, conn.metaPhoneNumberId, conn.metaToken);
      if (!ok) errorMsg = "Falha ao enviar via Meta API (token de acesso desta conexão pode estar expirado/inválido)";
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
    if (!ok) errorMsg = "Falha ao enviar via UazAPI (instância desconectada?)";
  } else {
    errorMsg = "Conexão encontrada sem credenciais configuradas (token ausente)";
  }

  if (ok) {
    // Salva no histórico como mensagem do assistente
    const activeConnId = serverSession?.id ?? wppSession?.id ?? evoSession?.id ?? extDevice?.id ?? conn?.id ?? connId ?? "";
    const savedContent = type === "text" ? content : `[${type}]`;
    addMessage(cleanPhone, { role: "assistant", content: savedContent, ts, type: type === "video" ? undefined : type }, clientId, { connId: activeConnId });
    // Pausa a IA nos dois storages
    setAiPaused(cleanPhone, true, clientId, activeConnId);
    // Busca o lead real pelo telefone (sem depender de funnelId) e atualiza
    const existingLead = getLeadByPhone(clientId, cleanPhone);
    if (existingLead) updateLead(existingLead.id, { aiPaused: true });
    // Cancela qualquer ciclo de resposta da IA já agendado para este telefone —
    // sem isso, um batch em "pending" no momento do envio manual do gestor ainda
    // dispararia e mandaria a resposta da IA por cima da mensagem dele.
    cancelPendingForPhone(clientId, cleanPhone);
  }

  return NextResponse.json({ ok, error: ok ? undefined : errorMsg });
}
