import { getConfig } from "./clients";
import os from "os";

function getWaServiceUrl() {
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name]!) {
      if (!iface.internal && iface.family === "IPv4") {
        return `http://${iface.address}:3002`;
      }
    }
  }
  return "http://localhost:3002";
}

export async function sendWhatsApp(phone: string, message: string): Promise<void> {
  const normalized = phone.replace(/\D/g, "");

  // Tenta enviar pelo serviço Baileys local primeiro
  try {
    const res = await fetch(`${getWaServiceUrl()}/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone: normalized, message }),
      signal: AbortSignal.timeout(8000),
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
