export type ServerWhatsAppStatus = {
  status: "connected" | "connecting" | "disconnected";
  phone: string | null;
  name: string | null;
};

const BASE_URL = (process.env.WA_SERVICE_URL || "http://127.0.0.1:3002").replace(/\/$/, "");

async function request<T>(pathname: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  headers.set("Content-Type", "application/json");
  if (process.env.WA_SERVICE_SECRET) {
    headers.set("x-wa-service-secret", process.env.WA_SERVICE_SECRET);
  }

  const response = await fetch(`${BASE_URL}${pathname}`, {
    ...init,
    headers,
    cache: "no-store",
    signal: AbortSignal.timeout(70_000),
  });
  const data = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) {
    throw new Error(data.error || `Serviço do WhatsApp respondeu HTTP ${response.status}`);
  }
  return data;
}

export async function getServerWhatsAppStatus(connectionId: string): Promise<ServerWhatsAppStatus> {
  return request<ServerWhatsAppStatus>(`/status/${encodeURIComponent(connectionId)}`);
}

export async function requestServerWhatsAppPairingCode(input: {
  connectionId: string;
  clientId: string;
  funnelId: string;
  phone: string;
}): Promise<{ code: string; status: ServerWhatsAppStatus["status"] }> {
  return request("/pairing-code", {
    method: "POST",
    body: JSON.stringify({ ...input, reset: true }),
  });
}

export async function disconnectServerWhatsApp(connectionId: string): Promise<void> {
  await request(`/disconnect/${encodeURIComponent(connectionId)}`, { method: "DELETE" });
}

export async function sendServerWhatsAppText(
  connectionId: string,
  phone: string,
  message: string,
): Promise<boolean> {
  try {
    const result = await request<{ ok: boolean }>("/send", {
      method: "POST",
      body: JSON.stringify({ connectionId, phone, message }),
    });
    return result.ok === true;
  } catch (error) {
    console.error(`[server-whatsapp] Falha ao enviar pela conexão ${connectionId}:`, error);
    return false;
  }
}

