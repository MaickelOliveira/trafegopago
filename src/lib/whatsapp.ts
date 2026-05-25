import { getConfig } from "./clients";

export async function sendWhatsApp(phone: string, message: string): Promise<void> {
  const normalized = phone.replace(/\D/g, "");

  const config = getConfig();
  const server = (config.uazapiServer ?? "https://nexopro.uazapi.com").replace(/\/$/, "");
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
