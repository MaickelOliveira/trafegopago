import { getConfig } from "./clients";

export async function sendWhatsApp(phone: string, message: string): Promise<void> {
  const normalized = phone.replace(/\D/g, "");
  const isPsid = normalized.length > 13;

  // PSIDs não funcionam via Baileys — vai direto para UazAPI
  if (!isPsid) {
    try {
      const res = await fetch("http://127.0.0.1:3002/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: normalized, message }),
        signal: AbortSignal.timeout(10000),
      });
      if (res.ok) return;
      const err = await res.text();
      console.error(`[WhatsApp] wa-service erro: ${res.status} — ${err}`);
    } catch (e) {
      console.error("[WhatsApp] wa-service inacessível:", e);
    }
  }

  // Fallback: UazAPI
  const config = getConfig();
  const server = config.uazapiServer ?? "https://nexopro.uazapi.com";
  const token = config.uazapiToken ?? "";
  if (!token) { console.warn("[WhatsApp] sem token UazAPI, mensagem não enviada"); return; }

  const res = await fetch(`${server}/send/text`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "token": token },
    body: JSON.stringify({ phone: normalized, message }),
  });
  if (!res.ok) {
    console.error(`[WhatsApp] Erro UazAPI ${normalized}: ${res.status}`);
  }
}
