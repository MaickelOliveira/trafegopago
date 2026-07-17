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
import { getEvolutionSessions } from "./evolution-sessions";
import { sendText as evoSendText, sendMedia as evoSendMedia } from "./evolution-api";
import { markPhoneSending, markSent as markWppSent } from "./wppconnect-sent";

export async function sendMessage(
  phone: string,
  message: string,
  clientId: string,
  preferredConnectionId?: string
): Promise<boolean> {
  const funnels = getFunnels().filter((f) => f.clientId === clientId);
  const allConns = funnels.flatMap((f) => (f.connections ?? []).map((c) => ({ ...c, funnelId: f.id })));

  // Se tem connectionId preferido, usa ele primeiro
  if (preferredConnectionId) {
    // WPPConnect: verifica sessões WPPConnect primeiro (não estão em funnels[].connections)
    const wppSessions = getWppSessions();
    const wppSession = wppSessions.find(s => s.id === preferredConnectionId);
    if (wppSession) {
      // Detecta número LID (≥13 dígitos, não começa com 55)
      const rawPhone = phone.replace(/@.*$/, "").replace(/\D/g, "");
      const isLid = rawPhone.length >= 13 && !rawPhone.startsWith("55");
      markPhoneSending(rawPhone);
      markWppSent(rawPhone, message);
      const ok = await wppSendText(wppSession.sessionName, wppSession.sessionToken, phone, message, isLid);
      if (ok) return true;
    }

    // Evolution API: mesmo racional — não está em funnels[].connections
    const evoSessions = getEvolutionSessions();
    const evoSession = evoSessions.find(s => s.id === preferredConnectionId);
    if (evoSession) {
      const rawPhone = phone.replace(/@.*$/, "").replace(/\D/g, "");
      const isLid = rawPhone.length >= 13 && !rawPhone.startsWith("55");
      markPhoneSending(rawPhone);
      markWppSent(rawPhone, message);
      const ok = await evoSendText(evoSession.instanceName, evoSession.instanceApiKey, phone, message, isLid, true);
      if (ok) return true;
    }

    const preferred = allConns.find((c) => c.id === preferredConnectionId);
    if (preferred) {
      // Meta Cloud API
      if (preferred.type === "meta" && preferred.metaPhoneNumberId && preferred.metaToken) {
        const ok = await sendMessageDirect(phone, message, preferred.metaPhoneNumberId, preferred.metaToken);
        if (ok) return true;
      }
      // UazAPI
      if (preferred.type === "uazapi" && preferred.uazapiToken) {
        const ok = await sendText(preferred.uazapiToken, phone, message);
        if (ok) return true;
      }
    }

  }

  // Fallback: tenta qualquer Meta da conta
  for (const funnel of funnels) {
    const metaConn = funnel.connections?.find((c) => c.type === "meta" && c.metaPhoneNumberId && c.metaToken);
    if (metaConn) {
      const ok = await sendMessageDirect(phone, message, metaConn.metaPhoneNumberId!, metaConn.metaToken!);
      if (ok) return true;
    }
  }

  // Fallback final: UazAPI
  await sendWhatsApp(phone, message);
  return true;
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
    const bodyText = await res.text().catch(() => "");
    let data: { error?: { message?: string } } | null = null;
    try { data = bodyText ? JSON.parse(bodyText) : null; } catch { /* corpo não-JSON */ }
    // Mesmo com status 2xx, a Graph API pode retornar um objeto "error" no corpo
    // (ex: janela de 24h fechada) — sem checar isso, marcávamos como enviado indevidamente.
    const ok = res.ok && !data?.error;
    if (!ok) {
      console.error(`[sendMessageDirect] FALHOU status=${res.status} phoneNumberId=${phoneNumberId} phone=${phone} body=${bodyText.slice(0, 300)}`);
    }
    return ok;
  } catch (e) {
    console.error(`[sendMessageDirect] EXCEÇÃO phoneNumberId=${phoneNumberId} phone=${phone}:`, e);
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
    const metaRes = await fetch(`https://graph.facebook.com/v19.0/${mediaId}`, {
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
      markPhoneSending(rawPhone);
      const ok = await wppSendMedia(wppSession.sessionName, wppSession.sessionToken, phone, mediaUrl, caption, isLid);
      if (ok) return;
    }
  }

  // Fallback: qualquer sessão WPPConnect do cliente
  for (const s of wppSessions) {
    const rawPhone = phone.replace(/@.*$/, "").replace(/\D/g, "");
    const isLid = rawPhone.length >= 13 && !rawPhone.startsWith("55");
    markPhoneSending(rawPhone);
    const ok = await wppSendMedia(s.sessionName, s.sessionToken, phone, mediaUrl, caption, isLid);
    if (ok) return;
  }

  // Evolution API: mesmo fluxo (preferida primeiro, depois qualquer sessão do cliente)
  const evoSessions = getEvolutionSessions().filter(s => s.clientId === clientId);
  if (preferredConnectionId) {
    const evoSession = evoSessions.find(
      s => s.id === preferredConnectionId || s.instanceName === preferredConnectionId,
    );
    if (evoSession) {
      const rawPhone = phone.replace(/@.*$/, "").replace(/\D/g, "");
      const isLid = rawPhone.length >= 13 && !rawPhone.startsWith("55");
      markPhoneSending(rawPhone);
      const ok = await evoSendMedia(evoSession.instanceName, evoSession.instanceApiKey, phone, mediaUrl, caption, isLid, true);
      if (ok) return;
    }
  }
  for (const s of evoSessions) {
    const rawPhone = phone.replace(/@.*$/, "").replace(/\D/g, "");
    const isLid = rawPhone.length >= 13 && !rawPhone.startsWith("55");
    markPhoneSending(rawPhone);
    const ok = await evoSendMedia(s.instanceName, s.instanceApiKey, phone, mediaUrl, caption, isLid, true);
    if (ok) return;
  }

  console.error(`[whatsapp-send] sendMediaMessage: no WPPConnect/Evolution session for clientId=${clientId}`);
}
