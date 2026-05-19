/**
 * Envia mensagem via Meta Cloud API (oficial) quando disponível,
 * com fallback para UazAPI.
 */

import { getFunnels } from "./funnels";
import { sendWhatsApp } from "./whatsapp";
import { getConfig } from "./clients";

export async function sendMessage(
  phone: string,
  message: string,
  clientId: string
): Promise<void> {
  // Tenta encontrar uma conexão Meta Cloud API para este cliente
  const funnels = getFunnels().filter((f) => f.clientId === clientId);
  for (const funnel of funnels) {
    const metaConn = funnel.connections?.find((c) => c.type === "meta" && c.metaPhoneNumberId && c.metaToken);
    if (metaConn) {
      try {
        const res = await fetch(
          `https://graph.facebook.com/v19.0/${metaConn.metaPhoneNumberId}/messages`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${metaConn.metaToken}`,
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
        if (res.ok) return;
        const err = await res.json().catch(() => ({}));
        console.error("[whatsapp-send] Meta API error:", err);
      } catch (e) {
        console.error("[whatsapp-send] Meta API exception:", e);
      }
    }
  }

  // Fallback: UazAPI
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
