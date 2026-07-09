import { getConfig } from "./clients";
import { markSent, markPhoneSending } from "./wppconnect-sent";
import { getCachedQr, clearCachedQr } from "./wppconnect-qr";

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

// O wppconnect.create() roda um ciclo interno de ~60s (autoClose) e só libera a
// sessão para um novo start-session depois que esse ciclo termina — chamadas
// dentro dessa janela são no-op e devolvem o QR antigo (já expirado) em cache.
const RESTART_INTERVAL_MS = 62000;
const lastStartAttempt = new Map<string, number>();

// true se já passou RESTART_INTERVAL_MS desde a última tentativa (ou force=true)
// — e já marca a tentativa atual. Compartilhado entre o painel do gestor e o do
// cliente pra evitar start-session duplicado/concorrente na mesma sessão.
export function shouldRestartWppSession(sessionName: string, force = false): boolean {
  const last = lastStartAttempt.get(sessionName) ?? 0;
  if (!force && Date.now() - last < RESTART_INTERVAL_MS) return false;
  lastStartAttempt.set(sessionName, Date.now());
  return true;
}

// Quanto falta (em ms) até o ciclo interno do WPPConnect liberar um novo
// start-session pra essa sessão — usado só pra avisar o usuário na tela
// ("aguarde Xs") em vez de deixar parecer que travou sem motivo.
export function getRestartCooldownRemainingMs(sessionName: string): number {
  const last = lastStartAttempt.get(sessionName) ?? 0;
  const remaining = RESTART_INTERVAL_MS - (Date.now() - last);
  return remaining > 0 ? remaining : 0;
}

// Inicia (ou reinicia) uma sessão com webhook configurado
export async function startSession(
  sessionName: string,
  token: string,
  webhookUrl: string,
): Promise<void> {
  // Invalida o QR cacheado da sessão anterior — o próximo evento "qrcode"
  // do webhook vai repopular com o QR da nova sessão.
  clearCachedQr(sessionName);
  if (!base()) return;
  // Fecha qualquer sessão/navegador anterior antes de reiniciar — sem isso, uma
  // sessão que já esteve autenticada e desconectou (ex: logout no celular) fica
  // "zumbi" no servidor: o start-session não gera QR novo porque o WPPConnect
  // tenta restaurar a sessão antiga em vez de abrir uma tela de QR limpa.
  // Em sessão nunca conectada (instância nova) isso é só um no-op inofensivo.
  await closeSession(sessionName, token);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
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
        autoReadMessages: false,
      }),
      signal: controller.signal,
    });
  } catch (e) {
    console.error(`[wppconnect-api] startSession FALHOU/TIMEOUT session=${sessionName}`, e);
  } finally {
    clearTimeout(timer);
  }
}

// Retorna o QR Code como base64 (data:image/png;base64,...)
export async function getQrCode(sessionName: string, token: string): Promise<string | null> {
  // qrcode-session é a fonte primária — às vezes acompanha as renovações
  // naturais do QR (~15-20s). O cache do webhook "qrcode" (gerado a partir
  // do urlcode, com margem correta) só dispara uma vez por start-session,
  // então fica como fallback para quando qrcode-session não retorna nada.
  if (!base()) return getCachedQr(sessionName);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_000);
  try {
    const res = await fetch(
      `${base()}/api/${sessionName}/qrcode-session`,
      { headers: { "Authorization": `Bearer ${token}` }, cache: "no-store", signal: controller.signal },
    );
    if (!res.ok) return getCachedQr(sessionName);
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
    if (!qr) return getCachedQr(sessionName);
    return qr.startsWith("data:") ? qr : `data:image/png;base64,${qr}`;
  } catch (e) {
    console.error(`[wppconnect-api] getQrCode FALHOU/TIMEOUT session=${sessionName}`, e);
    return getCachedQr(sessionName);
  } finally {
    clearTimeout(timer);
  }
}

// Status da sessão: CONNECTED | DISCONNECTED
export async function checkConnectionStatus(
  sessionName: string,
  token: string,
): Promise<string> {
  if (!base()) return "DISCONNECTED";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(
      `${base()}/api/${sessionName}/check-connection-session`,
      { headers: { "Authorization": `Bearer ${token}` }, cache: "no-store", signal: controller.signal },
    );
    if (!res.ok) return "UNKNOWN";
    const data = await res.json() as Record<string, unknown>;
    if (typeof data.status === "boolean") {
      return data.status ? "CONNECTED" : "DISCONNECTED";
    }
    const s = String(data.status ?? data.state ?? "").toUpperCase();
    if (s === "CONNECTED" || s === "ISLOGGED" || s === "OPEN" || s === "AUTHENTICATED") return "CONNECTED";
    if (s === "QRCODE" || s === "STARTING" || s === "INITIALIZING") return "QRCODE";
    if (s === "DISCONNECTED" || s === "NOTLOGGED" || s === "CLOSED") return "DISCONNECTED";
    return s || "UNKNOWN";
  } catch {
    return "UNKNOWN";
  } finally {
    clearTimeout(timer);
  }
}

// Fecha a sessão (desconecta sem apagar)
export async function closeSession(sessionName: string, token: string): Promise<void> {
  if (!base()) return;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_000);
  try {
    await fetch(`${base()}/api/${sessionName}/close-session`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${token}` },
      signal: controller.signal,
    });
  } catch (e) {
    console.error(`[wppconnect-api] closeSession FALHOU/TIMEOUT session=${sessionName}`, e);
  } finally {
    clearTimeout(timer);
  }
}

// Logout completo (apaga a sessão)
export async function logoutSession(sessionName: string, token: string): Promise<void> {
  clearCachedQr(sessionName);
  if (!base()) return;
  // logout-session só tem efeito em sessões já autenticadas — uma sessão presa
  // na tela de QR (nunca escaneada) ignora essa chamada e mantém o navegador
  // (e o QR em cache) ativo. close-session encerra o navegador independente do
  // estado, então chamamos os dois sempre, sem depender do resultado um do outro.
  await fetch(`${base()}/api/${sessionName}/logout-session`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${token}` },
  }).catch(() => {});
  await closeSession(sessionName, token);
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
    // ≥13 dígitos sem "55" → provavelmente LID (tratado em sendText com isLid=true)
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
    const isGroup = phone.endsWith("@g.us");
    const phoneFormatted = isLid
      ? phone.replace(/@.*/, "")
      : isGroup
        ? phone  // grupos: envia o JID completo como está (ex: 120363xxx@g.us)
        : normalizeBrPhone(phone);
    // Marca ANTES de enviar para que o eco fromMe seja ignorado pelo webhook
    const phoneKey = phoneFormatted.replace(/@.*/, "").replace(/\D/g, "");
    markPhoneSending(phoneKey); // janela 30s: cobre onanymessage + onselfmessage
    markSent(phoneKey, message); // match exato: fallback preciso
    const res = await fetch(
      `${base()}/api/${sessionName}/send-message`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`,
        },
        body: JSON.stringify({ phone: phoneFormatted, message, isGroup, ...(isLid ? { isLid: true } : {}) }),
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

// Detecta MIME type e extensão a partir de URL ou content-type
function detectMime(url: string, contentType: string): { mime: string; ext: string; type: "image" | "video" | "audio" | "document" } {
  const ct = contentType.split(";")[0].trim().toLowerCase();
  if (ct && ct !== "application/octet-stream") {
    if (ct.startsWith("image/")) return { mime: ct, ext: ct.split("/")[1] ?? "jpg", type: "image" };
    if (ct.startsWith("video/")) return { mime: ct, ext: ct.split("/")[1] ?? "mp4", type: "video" };
    if (ct.startsWith("audio/")) return { mime: ct, ext: ct.split("/")[1] ?? "ogg", type: "audio" };
  }
  // Fallback: detecta pela extensão da URL
  const ext = url.split("?")[0].split(".").pop()?.toLowerCase() ?? "";
  const extMap: Record<string, { mime: string; type: "image" | "video" | "audio" | "document" }> = {
    jpg: { mime: "image/jpeg", type: "image" }, jpeg: { mime: "image/jpeg", type: "image" },
    png: { mime: "image/png", type: "image" }, gif: { mime: "image/gif", type: "image" },
    webp: { mime: "image/webp", type: "image" },
    mp4: { mime: "video/mp4", type: "video" }, mov: { mime: "video/quicktime", type: "video" },
    mp3: { mime: "audio/mpeg", type: "audio" }, ogg: { mime: "audio/ogg", type: "audio" },
    wav: { mime: "audio/wav", type: "audio" }, m4a: { mime: "audio/mp4", type: "audio" },
    pdf: { mime: "application/pdf", type: "document" },
    doc: { mime: "application/msword", type: "document" },
    docx: { mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", type: "document" },
  };
  const info = extMap[ext];
  if (info) return { ...info, ext };
  return { mime: "application/octet-stream", ext: ext || "bin", type: "document" };
}

// Envia mídia (imagem, vídeo, documento ou áudio) via WPPConnect
// Baixa da URL, converte para base64 e envia pelo endpoint correto
export async function sendMedia(
  sessionName: string,
  token: string,
  phone: string,
  mediaUrl: string,
  caption?: string,
  isLid = false,
): Promise<boolean> {
  if (!base()) return false;
  try {
    const phoneFormatted = isLid
      ? phone.replace(/@.*/, "")
      : normalizeBrPhone(phone);
    const phoneKey = phoneFormatted.replace(/@.*/, "").replace(/\D/g, "");

    // Marca antes de enviar: impede que o eco onselfmessage pause a IA
    markPhoneSending(phoneKey); // janela 30s: cobre onanymessage + onselfmessage
    if (caption?.trim()) markSent(phoneKey, caption.trim()); // match exato para legenda
    console.log(`[wppconnect-api] sendMedia markPhoneSending phone=${phoneKey} caption="${(caption ?? "").slice(0, 60)}"`);

    // Baixa o arquivo
    const fileRes = await fetch(mediaUrl);
    if (!fileRes.ok) {
      console.error(`[wppconnect-api] sendMedia: failed to download ${mediaUrl} status=${fileRes.status}`);
      return false;
    }
    const contentType = fileRes.headers.get("content-type") ?? "";
    const { mime, ext, type } = detectMime(mediaUrl, contentType);
    const buffer = await fileRes.arrayBuffer();
    const base64Data = `data:${mime};base64,${Buffer.from(buffer).toString("base64")}`;
    const filename = `file.${ext}`;

    // Áudio → send-voice
    if (type === "audio") {
      const res = await fetch(`${base()}/api/${sessionName}/send-voice`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
        body: JSON.stringify({
          phone: isLid ? `${phoneFormatted}@lid` : phoneFormatted,
          base64: base64Data,
          ...(isLid ? { isLid: true } : {}),
        }),
      });
      if (!res.ok) console.error(`[wppconnect-api] send-voice FAILED status=${res.status} body=${await res.text().catch(() => "")}`);
      return res.ok;
    }

    // Imagem → send-image (melhor preview)
    if (type === "image") {
      const res = await fetch(`${base()}/api/${sessionName}/send-image`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
        body: JSON.stringify({
          phone: isLid ? `${phoneFormatted}@lid` : phoneFormatted,
          base64: base64Data,
          filename,
          caption: caption ?? "",
          ...(isLid ? { isLid: true } : {}),
        }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        console.error(`[wppconnect-api] send-image FAILED status=${res.status} body=${body}`);
      }
      return res.ok;
    }

    // Vídeo e Documento → send-file-base64
    const res = await fetch(`${base()}/api/${sessionName}/send-file-base64`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
      body: JSON.stringify({
        phone: isLid ? `${phoneFormatted}@lid` : phoneFormatted,
        base64: base64Data,
        filename,
        caption: caption ?? "",
        ...(isLid ? { isLid: true } : {}),
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error(`[wppconnect-api] send-file-base64 FAILED status=${res.status} body=${body}`);
    }
    return res.ok;
  } catch (e) {
    console.error(`[wppconnect-api] sendMedia EXCEPTION session=${sessionName}`, e);
    return false;
  }
}

// Envia mídia a partir de base64 já resolvido (sem baixar de URL)
export async function sendMediaFromBase64(
  sessionName: string,
  token: string,
  phone: string,
  base64DataUri: string, // data:mime;base64,...
  mimeType: string,
  caption?: string,
  isLid = false,
): Promise<boolean> {
  if (!base()) return false;
  try {
    const phoneFormatted = isLid ? phone.replace(/@.*/, "") : normalizeBrPhone(phone);
    const phoneKey = phoneFormatted.replace(/@.*/, "").replace(/\D/g, "");
    markPhoneSending(phoneKey);
    if (caption?.trim()) markSent(phoneKey, caption.trim());

    const rawExt = mimeType.split("/")[1]?.split(";")[0] ?? "bin";
    const ext = rawExt === "jpeg" ? "jpg" : rawExt;
    const filename = `file.${ext}`;
    const type = mimeType.startsWith("image/") ? "image"
               : mimeType.startsWith("video/") ? "video"
               : mimeType.startsWith("audio/") ? "audio"
               : "document";

    if (type === "audio") {
      const res = await fetch(`${base()}/api/${sessionName}/send-voice`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
        body: JSON.stringify({ phone: isLid ? `${phoneFormatted}@lid` : phoneFormatted, base64: base64DataUri, ...(isLid ? { isLid: true } : {}) }),
      });
      if (!res.ok) console.error(`[wppconnect-api] sendMediaFromBase64 send-voice FAILED status=${res.status}`);
      return res.ok;
    }
    if (type === "image") {
      const res = await fetch(`${base()}/api/${sessionName}/send-image`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
        body: JSON.stringify({ phone: isLid ? `${phoneFormatted}@lid` : phoneFormatted, base64: base64DataUri, filename, caption: caption ?? "", ...(isLid ? { isLid: true } : {}) }),
      });
      if (!res.ok) console.error(`[wppconnect-api] sendMediaFromBase64 send-image FAILED status=${res.status}`);
      return res.ok;
    }
    const res = await fetch(`${base()}/api/${sessionName}/send-file-base64`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
      body: JSON.stringify({ phone: isLid ? `${phoneFormatted}@lid` : phoneFormatted, base64: base64DataUri, filename, caption: caption ?? "", ...(isLid ? { isLid: true } : {}) }),
    });
    if (!res.ok) console.error(`[wppconnect-api] sendMediaFromBase64 send-file-base64 FAILED status=${res.status}`);
    return res.ok;
  } catch (e) {
    console.error(`[wppconnect-api] sendMediaFromBase64 EXCEPTION session=${sessionName}`, e);
    return false;
  }
}

// Extrai o JID string de um campo id do WPPConnect (pode ser string ou objeto {_serialized})
function extractJid(id: unknown): string {
  if (typeof id === "string") return id;
  if (id && typeof id === "object") {
    const obj = id as Record<string, unknown>;
    if (typeof obj._serialized === "string") return obj._serialized;
    if (typeof obj.user === "string") return obj.user;
  }
  return "";
}

// Ativa o indicador "digitando..." para um número via WPPConnect
export async function startTyping(
  sessionName: string,
  token: string,
  phone: string,
): Promise<void> {
  if (!base()) return;
  try {
    await fetch(`${base()}/api/${sessionName}/start-typing`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
      body: JSON.stringify({ phone }),
    });
  } catch { /* ignora — não-crítico */ }
}

// Para o indicador "digitando..." para um número via WPPConnect
export async function stopTyping(
  sessionName: string,
  token: string,
  phone: string,
): Promise<void> {
  if (!base()) return;
  try {
    await fetch(`${base()}/api/${sessionName}/stop-typing`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
      body: JSON.stringify({ phone }),
    });
  } catch { /* ignora — não-crítico */ }
}

// Marca a conversa como NÃO lida. Enviar uma mensagem a partir do número
// conectado marca a conversa como lida no WhatsApp automaticamente (efeito
// colateral do próprio app) — os clientes preferem que ela continue aparecendo
// como não lida no celular deles para conseguirem acompanhar as conversas
// pelo próprio WhatsApp, mesmo com a IA respondendo automaticamente.
export async function markUnseen(
  sessionName: string,
  token: string,
  phone: string,
  isLid = false,
): Promise<void> {
  if (!base()) return;
  try {
    const phoneFormatted = isLid ? phone.replace(/@.*/, "") : normalizeBrPhone(phone);
    await fetch(`${base()}/api/${sessionName}/mark-unseen`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
      body: JSON.stringify({ phone: phoneFormatted, isGroup: false }),
    });
  } catch { /* ignora — não-crítico */ }
}

// Lista todos os grupos do WhatsApp conectado nesta sessão
export async function listGroups(
  sessionName: string,
  token: string,
): Promise<{ id: string; name: string }[]> {
  if (!base()) return [];

  function parseGroups(data: unknown): { id: string; name: string }[] {
    const arr = (Array.isArray(data) ? data : (data as Record<string, unknown>)?.response) as Record<string, unknown>[] | undefined;
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((c) => {
        if (c.isGroup === true) return true;
        const jid = extractJid(c.id);
        return jid.endsWith("@g.us");
      })
      .map((c) => {
        const jid = extractJid(c.id);
        const name = String(c.name ?? c.formattedTitle ?? c.title ?? "Grupo sem nome");
        return { id: jid, name };
      })
      .filter((g) => g.id);
  }

  try {
    // Tenta list-chats primeiro (retorna todos os chats incluindo grupos)
    const res = await fetch(
      `${base()}/api/${sessionName}/list-chats`,
      { headers: { "Authorization": `Bearer ${token}` }, cache: "no-store" },
    );
    if (res.ok) {
      const data = await res.json() as unknown;
      const groups = parseGroups(data);
      if (groups.length > 0) return groups;
    }

    // Fallback: all-contacts filtrando por @g.us
    const res2 = await fetch(
      `${base()}/api/${sessionName}/all-contacts`,
      { headers: { "Authorization": `Bearer ${token}` }, cache: "no-store" },
    );
    if (res2.ok) {
      const data2 = await res2.json() as unknown;
      return parseGroups(data2);
    }

    return [];
  } catch {
    return [];
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

// Busca o nome (pushname) de um contato via WPPConnect.
// Usado quando o operador envia a primeira mensagem para o lead:
// nesse caso não há pushName no webhook (fromMe=true), então buscamos via API.
// Retorna o pushname do contato ou null se não encontrado.
export async function getContactName(
  sessionName: string,
  token: string,
  phone: string, // dígitos puros, ex: "5544998841285"
): Promise<string | null> {
  if (!base()) return null;
  try {
    const jid = `${phone}@c.us`;
    const res = await fetch(
      `${base()}/api/${sessionName}/contact/${encodeURIComponent(jid)}`,
      { headers: { "Authorization": `Bearer ${token}` }, cache: "no-store" },
    );
    if (!res.ok) return null;
    const data = await res.json() as Record<string, unknown>;
    // WPPConnect retorna: { status: "success", response: { pushname, name, ... } }
    // ou às vezes: { response: { contact: { pushname, ... } } }
    const resp = (data.response ?? data) as Record<string, unknown>;
    const contact = (resp.contact as Record<string, unknown>) ?? resp;
    const name =
      (contact.pushname as string) ||
      (contact.name as string) ||
      (resp.pushname as string) ||
      (resp.name as string) ||
      null;
    if (name && name.trim() && !/^\d+$/.test(name.trim())) {
      console.log(`[WPPConnect] getContactName ${phone} → "${name}"`);
      return name.trim();
    }
    return null;
  } catch {
    return null;
  }
}
