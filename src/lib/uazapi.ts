import { getConfig } from "./clients";

function base(): string {
  return (getConfig().uazapiServer || "https://nexopro.uazapi.com").replace(/\/$/, "");
}

function globalToken(): string {
  return getConfig().uazapiToken || "";
}

export async function listInstances(): Promise<unknown[]> {
  try {
    const res = await fetch(`${base()}/instance/all`, {
      headers: { token: globalToken() },
      cache: "no-store",
    });
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

// Passo 1: cria a instância no servidor UazAPI (retorna token da instância)
export async function createInstance(name: string): Promise<{ id?: string; token?: string; instanceToken?: string; [key: string]: unknown }> {
  try {
    const res = await fetch(`${base()}/instance/create`, {
      method: "POST",
      headers: { "Content-Type": "application/json", token: globalToken() },
      body: JSON.stringify({ name }),
    });
    const data = await res.json().catch(() => ({}));
    console.log("[UazAPI] createInstance response:", JSON.stringify(data).slice(0, 500));
    return data ?? {};
  } catch (e) {
    console.log("[UazAPI] createInstance error:", e);
    return {};
  }
}

// Passo 2: conecta a instância e retorna o QR code (usa o token da instância)
export async function connectInstance(instanceToken: string): Promise<{ qr?: string; qrcode?: string; status?: string; [key: string]: unknown }> {
  try {
    const res = await fetch(`${base()}/instance/connect`, {
      method: "POST",
      headers: { "Content-Type": "application/json", token: instanceToken },
      body: JSON.stringify({}),
    });
    const data = await res.json().catch(() => ({}));
    console.log("[UazAPI] connectInstance response:", JSON.stringify(data).slice(0, 500));
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

export async function getInstanceStatus(token: string): Promise<{ status: string; phone?: string; qr?: string; name?: string }> {
  try {
    const res = await fetch(`${base()}/instance/status`, {
      headers: { token },
      cache: "no-store",
    });
    if (!res.ok) return { status: "disconnected" };
    const data = await res.json();
    console.log("[UazAPI] getInstanceStatus response:", JSON.stringify(data).slice(0, 500));
    // Suporta vários formatos de campo QR e status usados por diferentes versões do UazAPI
    const qr = data.qr ?? data.qrCode ?? data.qr_code ?? data.base64 ?? data.qrcode ?? undefined;
    const phone = (data.phone ?? data.number ?? data.jid ?? data.phoneNumber ?? "").replace(/\D/g, "") || undefined;
    const connected = data.connected === true || data.status === "connected" || data.state === "open";
    return {
      status: connected ? "connected" : (data.status ?? data.state ?? "disconnected"),
      phone,
      qr,
      name: data.name ?? data.pushName ?? undefined,
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
    const res = await fetch(`${base()}/send/text`, {
      method: "POST",
      headers: { "Content-Type": "application/json", token },
      body: JSON.stringify({ phone, message }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
