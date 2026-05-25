import { getConfig } from "./clients";

function base(): string {
  const url = process.env.UAZAPI_SERVER
    || getConfig().uazapiServer
    || "https://nexopro.uazapi.com";
  return url.replace(/\/$/, "");
}

function globalToken(): string {
  return process.env.UAZAPI_TOKEN || getConfig().uazapiToken || "";
}

// Expõe o token global para uso nas rotas
export function getGlobalToken(): string {
  return globalToken();
}

// ── UazapiGO usa dois headers diferentes ─────────────────────────────────────
// • token      → token da instância (enviar msgs, status da instância)
// • AdminToken → token master do servidor (listar todas, criar, deletar)

function adminHeaders(): Record<string, string> {
  const aTok = adminToken();
  return { "AdminToken": aTok, "token": aTok };
}

export async function listInstances(): Promise<unknown[]> {
  try {
    // UazapiGO: GET /instance/all requer header "AdminToken" (A maiúsculo)
    const res = await fetch(`${base()}/instance/all`, {
      headers: adminHeaders(),
      cache: "no-store",
    });
    const text = await res.text();
    console.log("[UazAPI] listInstances status:", res.status, "| body:", text.slice(0, 800));

    if (!res.ok) return await listFallbackSingleInstance();

    let data: unknown;
    try { data = JSON.parse(text || "[]"); } catch { data = []; }

    // Array direto (formato mais comum)
    if (Array.isArray(data) && (data as unknown[]).length > 0) return data as unknown[];

    // Objeto com campo "instances", "data" ou variantes
    const obj = data as Record<string, unknown>;
    if (obj?.instances && Array.isArray(obj.instances)) return obj.instances as unknown[];
    if (obj?.Instances && Array.isArray(obj.Instances)) return obj.Instances as unknown[];
    if (obj?.data && Array.isArray(obj.data)) return obj.data as unknown[];

    // Objeto único (single-instance)
    if (obj && typeof obj === "object" && (obj.token || obj.status || obj.name || obj.id)) {
      return [obj];
    }

    return await listFallbackSingleInstance();
  } catch {
    return await listFallbackSingleInstance();
  }
}

async function listFallbackSingleInstance(): Promise<unknown[]> {
  const tok = globalToken();
  if (!tok) return [];
  try {
    const res = await fetch(`${base()}/instance/status`, {
      headers: { token: tok },
      cache: "no-store",
    });
    if (!res.ok) return [];
    const raw = await res.json() as Record<string, unknown>;
    // UazapiGO retorna { instance: {...}, status: {...} }
    const inst = (raw.instance ?? raw) as Record<string, unknown>;
    const st   = (raw.status   ?? {})  as Record<string, unknown>;
    if (inst.name || inst.id || st.jid) {
      return [{ ...raw, token: (inst.token as string) || tok }];
    }
    return [];
  } catch {
    return [];
  }
}

function adminToken(): string {
  return process.env.UAZAPI_ADMIN_TOKEN || getConfig().uazapiAdminToken || globalToken();
}

// Passo 1: cria a instância no servidor UazAPI (retorna token da instância)
// UazapiGO requer header "AdminToken" para criar instâncias
export async function createInstance(name: string): Promise<{ id?: string; token?: string; instanceToken?: string; [key: string]: unknown }> {
  const url = `${base()}/instance/create`;
  const aTok = adminToken();
  console.log("[UazAPI] createInstance URL:", url, "| adminToken:", aTok ? aTok.slice(0, 8) + "..." : "VAZIO");
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...adminHeaders() },
      body: JSON.stringify({ name }),
    });
    const text = await res.text();
    console.log("[UazAPI] createInstance status:", res.status, "| body:", text.slice(0, 500));
    const data = JSON.parse(text || "{}");
    // UazapiGO retorna { instance: { token, id, ... } }
    const inst = (data.instance ?? data) as Record<string, unknown>;
    return { ...data, token: (inst.token as string) || (data.token as string), id: (inst.id as string) || (data.id as string) };
  } catch (e) {
    console.log("[UazAPI] createInstance error:", e);
    return {};
  }
}

// Passo 2: conecta a instância e retorna o QR code (usa o token da instância)
export async function connectInstance(instanceToken: string): Promise<{ qr?: string; qrcode?: string; status?: string; [key: string]: unknown }> {
  console.log("[UazAPI] connectInstance token:", instanceToken ? instanceToken.slice(0, 8) + "..." : "VAZIO");
  try {
    const res = await fetch(`${base()}/instance/connect`, {
      method: "POST",
      headers: { "Content-Type": "application/json", token: instanceToken },
      body: JSON.stringify({}),
    });
    const text = await res.text();
    console.log("[UazAPI] connectInstance status:", res.status, "| body:", text.slice(0, 500));
    const data = JSON.parse(text || "{}");
    return data ?? {};
  } catch (e) {
    console.log("[UazAPI] connectInstance error:", e);
    return {};
  }
}

// QR code dedicado (alguns UazAPI expõem em endpoint separado)
export async function getQrCode(instanceToken: string): Promise<string | null> {
  try {
    const res = await fetch(`${base()}/instance/qrcode`, {
      headers: { token: instanceToken },
      cache: "no-store",
    });
    if (!res.ok) return null;
    const data = await res.json();
    console.log("[UazAPI] getQrCode response:", JSON.stringify(data).slice(0, 200));
    return data.qrcode ?? data.qr ?? data.base64 ?? data.qr_code ?? null;
  } catch {
    return null;
  }
}

export async function disconnectInstance(token: string): Promise<void> {
  try {
    await fetch(`${base()}/instance/disconnect`, {
      method: "POST",
      headers: { "Content-Type": "application/json", token },
      body: JSON.stringify({}),
    });
  } catch { }
}

// Logout completo — apaga a sessão salva, próximo /connect mostra QR
export async function logoutInstance(token: string): Promise<void> {
  try {
    // Tenta endpoint de logout (apaga sessão)
    await fetch(`${base()}/instance/logout`, {
      method: "POST",
      headers: { "Content-Type": "application/json", token },
      body: JSON.stringify({}),
    });
  } catch { }
  // Desconecta também por segurança
  try {
    await fetch(`${base()}/instance/disconnect`, {
      method: "POST",
      headers: { "Content-Type": "application/json", token },
      body: JSON.stringify({}),
    });
  } catch { }
}

export async function getInstanceStatus(token: string): Promise<{ status: string; phone?: string; qr?: string; name?: string; instanceToken?: string }> {
  try {
    const res = await fetch(`${base()}/instance/status`, {
      headers: { token },
      cache: "no-store",
    });
    if (!res.ok) return { status: "disconnected" };
    const data = await res.json() as Record<string, unknown>;
    console.log("[UazAPI] getInstanceStatus response:", JSON.stringify(data).slice(0, 300));

    // UazapiGO retorna { instance: {...}, status: { connected, jid, loggedIn } }
    const inst = (data.instance ?? data) as Record<string, unknown>;
    const st   = (data.status   ?? {})  as Record<string, unknown>;

    const qr = (inst.qrcode ?? inst.qr ?? inst.qr_code ?? inst.base64 ?? data.qrcode ?? data.qr) as string | undefined;

    // Telefone: prefer inst.owner (UazapiGO), fallback para jid do status
    const rawPhone = (inst.owner ?? inst.phone ?? inst.number ?? st.jid ?? "") as string;
    const phone = rawPhone.replace(/\D/g, "").replace(/@.*/, "") || undefined;

    // Conectado: UazapiGO usa status.connected=true OU inst.status="connected"
    const connected = st.connected === true
      || data.connected === true
      || String(inst.status).toLowerCase() === "connected"
      || String(inst.state).toLowerCase() === "open";

    return {
      status: connected ? "connected" : (String(inst.status ?? inst.state ?? "disconnected")),
      phone,
      qr,
      name: (inst.name ?? inst.pushName ?? inst.profileName) as string | undefined,
      instanceToken: (inst.token) as string | undefined,
    };
  } catch {
    return { status: "disconnected" };
  }
}

export async function setWebhook(token: string, url: string): Promise<void> {
  try {
    await fetch(`${base()}/webhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json", token },
      body: JSON.stringify({
        url,
        events: ["messages"],
        excludeMessages: ["wasSentByApi", "isGroupYes"],
        enabled: true,
      }),
    });
  } catch { }
}

export async function updateFieldsMap(token: string): Promise<void> {
  try {
    await fetch(`${base()}/instance/updateFieldsMap`, {
      method: "POST",
      headers: { "Content-Type": "application/json", token },
      body: JSON.stringify({ instancePhone: true, instanceId: true, pushName: true }),
    });
  } catch { }
}

export async function sendText(token: string, phone: string, message: string): Promise<boolean> {
  try {
    const url = `${base()}/send/text`;
    // UazapiGO usa "body" para o texto, não "message"
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", token },
      body: JSON.stringify({ phone, body: message }),
    });
    const resText = await res.text();
    if (!res.ok) {
      console.error(`[sendText] ERRO ${res.status} → ${url} phone=${phone} token=${token.slice(0,8)}... resp=${resText.slice(0, 300)}`);
    }
    return res.ok;
  } catch (e) {
    console.error("[sendText] EXCEPTION:", e);
    return false;
  }
}

export async function sendMedia(
  token: string,
  phone: string,
  type: "image" | "audio" | "video",
  urlOrBase64: string,
  caption?: string,
): Promise<boolean> {
  const endpoint = type === "image" ? "image" : type === "audio" ? "audio" : "video";
  try {
    const isBase64 = urlOrBase64.startsWith("data:") || !urlOrBase64.startsWith("http");
    const body: Record<string, unknown> = { phone, caption };
    if (isBase64) {
      body.base64 = urlOrBase64;
    } else {
      body.url = urlOrBase64;
    }
    const res = await fetch(`${base()}/send/${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", token },
      body: JSON.stringify(body),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function getPairingCode(token: string, phone: string): Promise<string | null> {
  try {
    const res = await fetch(`${base()}/instance/pairingCode`, {
      method: "POST",
      headers: { "Content-Type": "application/json", token },
      body: JSON.stringify({ phone }),
    });
    const text = await res.text();
    console.log("[UazAPI] getPairingCode status:", res.status, "| body:", text.slice(0, 300));
    const data = JSON.parse(text || "{}");
    return (data.code ?? data.pairingCode ?? data.pairing_code ?? null) as string | null;
  } catch (e) {
    console.log("[UazAPI] getPairingCode error:", e);
    return null;
  }
}

// UazapiGO: deletar instância requer AdminToken
export async function deleteInstance(instanceToken: string): Promise<void> {
  try {
    await fetch(`${base()}/instance`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json", ...adminHeaders(), token: instanceToken },
    });
  } catch { }
}
