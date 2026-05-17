import { getConfig } from "./clients";

export async function sendWhatsApp(phone: string, message: string): Promise<void> {
  const normalized = phone.replace(/\D/g, "");

  // Tenta enviar pelo serviço Baileys local primeiro
  try {
    const res = await fetch("http://localhost:3002/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone: normalized, message }),
    });
    if (res.ok) return;
  } catch { /* fallback para UazAPI */ }

  // Fallback: UazAPI
  const config = getConfig();
  const server = config.uazapiServer ?? "https://nexopro.uazapi.com";
  const token = config.uazapiToken ?? "";
  if (!token) { console.warn("[WhatsApp] sem token UazAPI"); return; }

  const res = await fetch(`${server}/send/text`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "token": token },
    body: JSON.stringify({ phone: normalized, message }),
  });
  if (!res.ok) {
    const body = await res.text();
    console.error(`[WhatsApp] Erro UazAPI ${normalized}: ${res.status} — ${body}`);
  }
}
