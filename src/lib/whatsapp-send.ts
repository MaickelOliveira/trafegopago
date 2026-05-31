/**
 * Envia mensagem via Meta Cloud API (oficial) quando disponível,
 * com fallback para UazAPI ou WPPConnect.
 */

import { getFunnels } from "./funnels";
import { sendWhatsApp } from "./whatsapp";
import { getConfig } from "./clients";
import { sendText } from "./uazapi";
import { getWppSessions } from "./wppconnect-sessions";
import { sendText as wppSendText, sendMedia as wppSendMedia } from "./wppconnect-api";
import { markSent as markWppSent } from "./wppconnect-sent";

export async function sendMessage(
  phone: string,
  message: string,
  clientId: string,
  preferredConnectionId?: string
): Promise<void> {
  const funnels = getFunnels().filter((f) => f.clientId === clientId);
  const allConns = funnels.flatMap((f) => (f.connections ?? []).map((c) => ({ ...c, funnelId: f.id })));

  // Se tem connectionId preferido, usa ele primeiro
  if (preferredConnectionId) {
    // WPPConnect: verifica sessões WPPConnect primeiro (não estão em funnels[].connections)
    const wppSessions = getWppSessions();
    const wppSession = wppSessions.find(s => s.id === preferredConnectionId);
    if (wppSession) {
      const normalizedPhone = phone.replace(/@.*/, "").replace(/\D/g, "");
      markWppSent(normalizedPhone, message); // evita que o echo fromMe pause a IA
      const ok = await wppSendText(wppSession.sessionName, wppSession.sessionToken, phone, message);
      if (ok) return;
    }

    const preferred = allConns.find((c) => c.id === preferredConnectionId);
    if (preferred) {
      // Meta Cloud API
      if (preferred.type === "meta" && preferred.metaPhoneNumberId && preferred.metaToken) {
        const ok = await sendMessageDirect(phone, message, preferred.metaPhoneNumberId, preferred.metaToken);
        if (ok) return;
      }
      // UazAPI
      if (preferred.type === "uazapi" && preferred.uazapiToken) {
        const ok = await sendText(preferred.uazapiToken, phone, message);
        if (ok) return;
      }
    }

  }

  // Fallback: tenta qualquer Meta da conta
  for (const funnel of funnels) {
    const metaConn = funnel.connections?.find((c) => c.type === "meta" && c.metaPhoneNumberId && c.metaToken);
    if (metaConn) {
      const ok = await sendMessageDirect(phone, message, metaConn.metaPhoneNumberId!, metaConn.metaToken!);
      if (ok) return;
    }
  }

  // Fallback final: UazAPI
  await sendWhatsApp(phone, message);
}

export async function sendMessageDirect(
  phone: string,
  message: string,
  phoneNumberId: string,
  accessToken: string
): Promise<boolean> {
  try {
    const res = await fetch(
      `https://graph.facebook.com/v19.0/${phoneNumberId}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: phone,
          type: "text",
          text: { body: message },
        }),
      }
    );
    return res.ok;
  } catch {
    return false;
  }
}

export function getGeminiApiKey(clientGeminiKey?: string): string | null {
  const config = getConfig();
  return (
    clientGeminiKey ||
    config.geminiApiKey ||
    process.env.GEMINI_API_KEY ||
    process.env.GOOGLE_IMAGEN_API_KEY ||
    null
  );
}

/**
 * Envia mídia (foto, vídeo, documento, áudio) via WPPConnect.
 * Usado pela IA para enviar arquivos de mídia na mesma conexão WPPConnect.
 */
export async function sendMediaMessage(
  phone: string,
  mediaUrl: string,
  clientId: string,
  caption?: string,
  preferredConnectionId?: string,
): Promise<void> {
  const wppSessions = getWppSessions().filter(s => s.clientId === clientId);

  // Sessão preferida
  if (preferredConnectionId) {
    const wppSession = wppSessions.find(
      s => s.id === preferredConnectionId || s.sessionName === preferredConnectionId,
    );
    if (wppSession) {
      const rawPhone = phone.replace(/@.*$/, "").replace(/\D/g, "");
      const isLid = rawPhone.length >= 13 && !rawPhone.startsWith("55");
      const ok = await wppSendMedia(wppSession.sessionName, wppSession.sessionToken, phone, mediaUrl, caption, isLid);
      if (ok) return;
    }
  }

  // Fallback: qualquer sessão WPPConnect do cliente
  for (const s of wppSessions) {
    const rawPhone = phone.replace(/@.*$/, "").replace(/\D/g, "");
    const isLid = rawPhone.length >= 13 && !rawPhone.startsWith("55");
    const ok = await wppSendMedia(s.sessionName, s.sessionToken, phone, mediaUrl, caption, isLid);
    if (ok) return;
  }
  console.error(`[whatsapp-send] sendMediaMessage: no WPPConnect session for clientId=${clientId}`);
}
