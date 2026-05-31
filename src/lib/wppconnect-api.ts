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

// Normaliza número brasileiro para formato WhatsApp (13 dígitos: 55 + DDD + 9 + 8 dígitos)
function normalizeBrPhone(raw: string): string {
  // Remove sufixo @c.us e tudo que não é dígito
  let d = raw.replace(/@.*$/, "").replace(/\D/g, "");
  if (!d) return raw;

  if (d.startsWith("55")) {
    // 12 dígitos → falta o 9 depois do DDD (ex: 554498765432 → 55449 8765432)
    if (d.length === 12) d = d.slice(0, 4) + "9" + d.slice(4);
    // 13 dígitos: já correto
  } else {
    // Sem código do país
    if (d.length === 10) d = "55" + d.slice(0, 2) + "9" + d.slice(2); // DDD + 8 dígitos
    if (d.length === 11) d = "55" + d;                                  // DDD + 9 + 8 dígitos
  }
  return `${d}@c.us`;
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
    // Para contatos normais, normaliza para formato brasileiro padrão
    const phoneFormatted = isLid
      ? phone.replace(/@.*/, "")
      : normalizeBrPhone(phone);
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

// Tenta resolver o número real de um contato LID via API do WPPConnect.
// Usa o endpoint /contact/pn-lid/{jid} (disponível desde dez/2025).
// Retorna o número real (ex: "5544XXXXXXXX") ou null se não conseguir resolver.
export async function resolveContactPhone(
  sessionName: string,
  token: string,
  contactId: string, // e.g. "18983856173090@lid" ou "18983856173090"
): Promise<string | null> {
  if (!base()) return null;
  // Garante que o JID está no formato completo
  const jid = contactId.includes("@") ? contactId : `${contactId}@lid`;
  const lidBase = contactId.replace(/@.*/, "").replace(/\D/g, "");
  try {
    // WPPConnect Server: GET /api/{session}/contact/pn-lid/{jid}
    // Retorna: { lid: { id, _serialized }, phoneNumber: { id, _serialized }, contact: {...} }
    const res = await fetch(
      `${base()}/api/${sessionName}/contact/pn-lid/${encodeURIComponent(jid)}`,
      { headers: { "Authorization": `Bearer ${token}` }, cache: "no-store" },
    );
    console.log(`[WPPConnect] pn-lid HTTP ${res.status} para ${jid}`);
    if (!res.ok) {
      const err = await res.text();
      console.log(`[WPPConnect] pn-lid erro: ${err.slice(0, 200)}`);
      return null;
    }
    const data = await res.json() as Record<string, unknown>;
    console.log(`[WPPConnect] pn-lid resposta: ${JSON.stringify(data).slice(0, 300)}`);
    // O endpoint retorna diretamente o objeto (sem wrapper .response)
    const phoneNumber = data.phoneNumber as Record<string, unknown> | undefined;
    if (phoneNumber) {
      // id é o número puro (ex: "5544XXXXXXXX"), _serialized inclui "@c.us"
      const raw = (phoneNumber.id as string) || (phoneNumber._serialized as string) || "";
      const digits = raw.replace(/@c\.us$/, "").replace(/@.*/, "").replace(/\D/g, "");
      if (digits && /^\d{10,15}$/.test(digits) && digits !== lidBase) {
        console.log(`[WPPConnect] pn-lid resolved: ${jid} → ${digits}`);
        return digits;
      }
    }
    return null;
  } catch {
    return null;
  }
}
