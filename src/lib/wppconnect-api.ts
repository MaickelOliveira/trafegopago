import { getConfig } from "./clients";

function base(): string {
  const url = process.env.WPPCONNECT_SERVER || getConfig().wppconnectServer || "";
  return url.replace(/\/$/, "");
}

function secretKey(): string {
  return process.env.WPPCONNECT_SECRET_KEY || getConfig().wppconnectSecretKey || "";
}

export function isWppConnectConfigured(): boolean {
  return !!base() && !!secretKey();
}

// Gera token JWT para uma sessão — precisa ser chamado UMA VEZ e armazenado
export async function generateToken(sessionName: string): Promise<string | null> {
  if (!base()) return null;
  try {
    const res = await fetch(`${base()}/api/${sessionName}/${secretKey()}/generate-token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    if (!res.ok) return null;
    const data = await res.json() as Record<string, unknown>;
    // WPPConnect retorna: { token, session, full: "Bearer {token}" }
    return (data.token as string) || ((data.full as string)?.replace("Bearer ", "")) || null;
  } catch {
    return null;
  }
}

// Inicia (ou reinicia) uma sessão com webhook configurado
export async function startSession(
  sessionName: string,
  token: string,
  webhookUrl: string,
): Promise<void> {
  if (!base()) return;
  try {
    await fetch(`${base()}/api/${sessionName}/start-session`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`,
      },
      body: JSON.stringify({
        webhook: webhookUrl,
        waitQrCode: false,
        whatsappVersion: "",
      }),
    });
  } catch { }
}

// Retorna o QR Code como base64 (data:image/png;base64,...)
export async function getQrCode(sessionName: string, token: string): Promise<string | null> {
  if (!base()) return null;
  try {
    const res = await fetch(
      `${base()}/api/${sessionName}/qrcode-session`,
      { headers: { "Authorization": `Bearer ${token}` }, cache: "no-store" },
    );
    if (!res.ok) return null;
    // WPPConnect pode retornar PNG binário direto ou JSON com base64
    const contentType = res.headers.get("content-type") || "";
    if (contentType.includes("image/")) {
      const buffer = await res.arrayBuffer();
      const base64 = Buffer.from(buffer).toString("base64");
      const mime = contentType.split(";")[0].trim();
      return `data:${mime};base64,${base64}`;
    }
    const data = await res.json() as Record<string, unknown>;
    const qr = (data.qrcode as string) || (data.base64 as string) || null;
    if (!qr) return null;
    return qr.startsWith("data:") ? qr : `data:image/png;base64,${qr}`;
  } catch {
    return null;
  }
}

// Status da sessão: CONNECTED | DISCONNECTED
export async function checkConnectionStatus(
  sessionName: string,
  token: string,
): Promise<string> {
  if (!base()) return "DISCONNECTED";
  try {
    const res = await fetch(
      `${base()}/api/${sessionName}/check-connection-session`,
      { headers: { "Authorization": `Bearer ${token}` }, cache: "no-store" },
    );
    if (!res.ok) return "DISCONNECTED";
    const data = await res.json() as Record<string, unknown>;
    // WPPConnect retorna { status: true/false } (boolean) ou string
    if (typeof data.status === "boolean") {
      return data.status ? "CONNECTED" : "DISCONNECTED";
    }
    return (data.status as string) || "DISCONNECTED";
  } catch {
    return "DISCONNECTED";
  }
}

// Fecha a sessão (desconecta sem apagar)
export async function closeSession(sessionName: string, token: string): Promise<void> {
  if (!base()) return;
  try {
    await fetch(`${base()}/api/${sessionName}/close-session`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${token}` },
    });
  } catch { }
}

// Logout completo (apaga a sessão)
export async function logoutSession(sessionName: string, token: string): Promise<void> {
  if (!base()) return;
  try {
    await fetch(`${base()}/api/${sessionName}/logout-session`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${token}` },
    });
  } catch {
    // Tenta close como fallback
    await closeSession(sessionName, token).catch(() => {});
  }
}

// Envia mensagem de texto
// isLid=true: para contatos com LID interno do WhatsApp (ex: 18983856173090@lid)
export async function sendText(
  sessionName: string,
  token: string,
  phone: string,
  message: string,
  isLid = false,
): Promise<boolean> {
  if (!base()) return false;
  try {
    // Para contatos LID, envia o número puro (sem @c.us) com isLid:true
    // Para contatos normais, formata como número@c.us
    const phoneFormatted = isLid
      ? phone.replace(/@.*/, "")           // remove qualquer sufixo existente
      : phone.includes("@") ? phone : `${phone}@c.us`;
    const res = await fetch(
      `${base()}/api/${sessionName}/send-message`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`,
        },
        body: JSON.stringify({ phone: phoneFormatted, message, isGroup: false, ...(isLid ? { isLid: true } : {}) }),
      },
    );
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error(`[wppconnect-api] sendText FAILED status=${res.status} session=${sessionName} phone=${phoneFormatted} isLid=${isLid} body=${body}`);
    }
    return res.ok;
  } catch (e) {
    console.error(`[wppconnect-api] sendText EXCEPTION session=${sessionName}`, e);
    return false;
  }
}

// Lista todas as sessões (se o servidor suportar)
export async function listSessions(): Promise<{ session: string; status: string }[]> {
  if (!base()) return [];
  try {
    const res = await fetch(
      `${base()}/api/${secretKey()}/show-all-sessions`,
      { cache: "no-store" },
    );
    if (!res.ok) return [];
    const data = await res.json() as unknown;
    return Array.isArray(data) ? data as { session: string; status: string }[] : [];
  } catch {
    return [];
  }
}
