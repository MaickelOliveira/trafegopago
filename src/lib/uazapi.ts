import { getConfig } from "./clients";
import { markSent as markSentRegistry, markPhoneSending } from "./wppconnect-sent";

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

/**
 * Calcula delay de digitação (ms) proporcional ao tamanho da mensagem.
 * Simula o tempo que um humano levaria para digitar — mostra "Digitando..." no WhatsApp.
 */
function typingDelay(text: string): number {
  // ~30ms por caractere, mínimo 800ms, máximo 4000ms
  return Math.min(Math.max(text.length * 30, 800), 4000);
}

export async function sendText(token: string, phone: string, message: string, delay?: number): Promise<boolean> {
  // Marca antes de enviar para que o eco fromMe não pause a IA
  const phoneKey = phone.replace(/\D/g, "");
  markPhoneSending(phoneKey); // janela 30s: cobre double-event do UazapiGO
  markSentRegistry(phoneKey, message);
  console.log(`[uazapi/sendText] markPhoneSending+markSent phone=${phoneKey} msg="${message.slice(0, 60)}"`);

  const url = `${base()}/send/text`;
  const ms = delay !== undefined ? delay : typingDelay(message);
  // Formato correto da uazapi: { number, text } — demais são fallback por compatibilidade
  const payloads = [
    { number: phone, text: message, delay: ms },
    { phone, message },
    { phone, body: message },
    { phone: `${phone}@s.whatsapp.net`, message },
  ];

  for (const payload of payloads) {
    try {
      const bodyStr = JSON.stringify(payload);
      console.log(`[sendText] tentando ${url} payload=${bodyStr.slice(0, 120)}`);
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", token },
        body: bodyStr,
      });
      const resText = await res.text();
      if (res.ok) {
        console.log(`[sendText] OK com payload keys=${Object.keys(payload).join(",")}`);
        return true;
      }
      console.warn(`[sendText] ${res.status} keys=${Object.keys(payload).join(",")} resp=${resText.slice(0, 200)}`);
    } catch (e) {
      console.error("[sendText] EXCEPTION:", e);
    }
  }
  return false;
}

export async function sendList(
  token: string,
  phone: string,
  title: string,
  buttonText: string,
  sections: { title: string; rows: { id: string; title: string; description?: string }[] }[],
): Promise<boolean> {
  try {
    const res = await fetch(`${base()}/send/list`, {
      method: "POST",
      headers: { "Content-Type": "application/json", token },
      body: JSON.stringify({ number: phone, title, buttonText, sections }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function sendMedia(
  token: string,
  phone: string,
  type: "image" | "audio" | "video" | "document",
  urlOrBase64: string,
  caption?: string,
  filename?: string,
): Promise<boolean> {
  try {
    // Marca antes de enviar: impede que o eco fromMe pause a IA
    const phoneKey = phone.replace(/\D/g, "");
    markPhoneSending(phoneKey); // janela 30s
    if (caption?.trim()) markSentRegistry(phoneKey, caption.trim());
    console.log(`[uazapi/sendMedia] markPhoneSending phone=${phoneKey} caption="${(caption ?? "").slice(0, 60)}"`);

    // UazapiGO nexopro: endpoint /send/media com {number, file, text, type}
    // "file" aceita URL pública ou data URI base64
    // "type" é obrigatório para enviar como mídia (image/video/audio/document)
    const body: Record<string, unknown> = {
      number: phone,
      file: urlOrBase64,
      text: caption ?? "",
      type,
    };
    if (type === "document" && filename) body.filename = filename;

    const res = await fetch(`${base()}/send/media`, {
      method: "POST",
      headers: { "Content-Type": "application/json", token },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      console.warn(`[sendMedia] ${res.status} type=${type} resp=${txt.slice(0, 200)}`);
    }
    return res.ok;
  } catch (e) {
    console.error("[sendMedia] EXCEPTION:", e);
    return false;
  }
}

/**
 * Divide uma resposta longa em partes menores respeitando parágrafos e frases.
 * Prioridade: dupla quebra → quebra simples → ponto/exclamação/interrogação → tamanho máximo.
 */
export function splitMessage(text: string, maxLen = 300): string[] {
  const trimmed = text.trim();
  if (trimmed.length <= maxLen) return [trimmed];

  const chunks: string[] = [];

  // 1ª tentativa: dividir por parágrafo (linha em branco)
  const paragraphs = trimmed.split(/\n\s*\n/);
  let current = "";

  for (const para of paragraphs) {
    const piece = para.trim();
    if (!piece) continue;

    if ((current + (current ? "\n\n" : "") + piece).length <= maxLen) {
      current += (current ? "\n\n" : "") + piece;
    } else {
      if (current) chunks.push(current);
      // Se o parágrafo sozinho já é maior que maxLen, divide por frase
      if (piece.length > maxLen) {
        const sentences = piece.split(/(?<=[.!?])\s+/);
        let sentBuf = "";
        for (const s of sentences) {
          if ((sentBuf + (sentBuf ? " " : "") + s).length <= maxLen) {
            sentBuf += (sentBuf ? " " : "") + s;
          } else {
            if (sentBuf) chunks.push(sentBuf);
            // Frase única maior que maxLen: tenta dividir por quebra de linha simples antes de palavras
            if (s.length > maxLen) {
              const lines = s.split("\n");
              if (lines.length > 1) {
                // Agrupa linhas sem exceder maxLen — nunca corta no meio de uma linha
                let lineBuf = "";
                for (const line of lines) {
                  const joined = lineBuf ? lineBuf + "\n" + line : line;
                  if (joined.length <= maxLen) {
                    lineBuf = joined;
                  } else {
                    if (lineBuf) chunks.push(lineBuf);
                    // Linha individual ainda maior que maxLen: divide por palavras
                    if (line.length > maxLen) {
                      const words = line.split(" ");
                      let wordBuf = "";
                      for (const w of words) {
                        if ((wordBuf + " " + w).length > maxLen) {
                          if (wordBuf) chunks.push(wordBuf);
                          wordBuf = w;
                        } else {
                          wordBuf += (wordBuf ? " " : "") + w;
                        }
                      }
                      lineBuf = wordBuf;
                    } else {
                      lineBuf = line;
                    }
                  }
                }
                sentBuf = lineBuf;
              } else {
                // Sem quebras de linha: divide por palavras
                const words = s.split(" ");
                let wordBuf = "";
                for (const w of words) {
                  if ((wordBuf + " " + w).length > maxLen) {
                    if (wordBuf) chunks.push(wordBuf);
                    wordBuf = w;
                  } else {
                    wordBuf += (wordBuf ? " " : "") + w;
                  }
                }
                sentBuf = wordBuf;
              }
            } else {
              sentBuf = s;
            }
          }
        }
        current = sentBuf;
      } else {
        current = piece;
      }
    }
  }

  if (current) chunks.push(current);
  return chunks.filter(Boolean);
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
