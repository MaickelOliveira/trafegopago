/**
 * Envia mensagem via Meta Cloud API (oficial) quando disponível,
 * com fallback para UazAPI.
 */

import { getFunnels } from "./funnels";
import { sendWhatsApp } from "./whatsapp";
import { getConfig } from "./clients";
import { sendText } from "./uazapi";

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
  return clientGeminiKey || config.geminiApiKey || null;
}
