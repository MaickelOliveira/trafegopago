import { getConfig } from "./clients";
import { markSent, markPhoneSending } from "./wppconnect-sent";
import { getCachedQr, setCachedQr, clearCachedQr } from "./evolution-qr";

function base(): string {
  const url = process.env.EVOLUTION_SERVER || getConfig().evolutionServer || "";
  return url.replace(/\/$/, "");
}

function adminKey(): string {
  return process.env.EVOLUTION_ADMIN_KEY || getConfig().evolutionAdminKey || "";
}

export function isEvolutionConfigured(): boolean {
  return !!base() && !!adminKey();
}

// A Evolution aceita a apikey global (admin) em qualquer chamada de gestão de
// instância. A apikey específica da instância (retornada em "hash" no create)
// é aceita nas chamadas de envio também — usamos ela quando disponível e caímos
// para a admin key como fallback (ex: instância criada antes de guardarmos o hash).
function authHeader(instanceApiKey?: string): Record<string, string> {
  return { apikey: instanceApiKey || adminKey() };
}

// O create() da Evolution é síncrono e devolve o QR na própria resposta —
// diferente do ciclo interno de ~60s do WPPConnect. Mantemos um cooldown curto
// só para evitar cliques duplicados/concorrentes no botão de reconectar do
// painel (gestor + cliente podem estar pollando ao mesmo tempo).
const RESTART_INTERVAL_MS = 15_000;
const lastStartAttempt = new Map<string, number>();

export function shouldRestartEvolutionSession(instanceName: string, force = false): boolean {
  const last = lastStartAttempt.get(instanceName) ?? 0;
  if (!force && Date.now() - last < RESTART_INTERVAL_MS) return false;
  lastStartAttempt.set(instanceName, Date.now());
  return true;
}

export function getEvolutionRestartCooldownRemainingMs(instanceName: string): number {
  const last = lastStartAttempt.get(instanceName) ?? 0;
  const remaining = RESTART_INTERVAL_MS - (Date.now() - last);
  return remaining > 0 ? remaining : 0;
}

function normalizeQr(qrcode: Record<string, unknown> | undefined): string | null {
  if (!qrcode) return null;
  const raw = (qrcode.base64 as string) || null;
  if (!raw) return null;
  return raw.startsWith("data:") ? raw : `data:image/png;base64,${raw}`;
}

// Cria a instância (ou reaproveita se já existir) e registra o webhook.
// Retorna a apikey da instância ("hash") e o QR já disponível na própria
// resposta do create — a Evolution não exige uma chamada separada para isso.
export async function createOrRestartInstance(
  instanceName: string,
  webhookUrl: string,
): Promise<{ apiKey: string; qrBase64: string | null } | null> {
  if (!base()) return null;
  clearCachedQr(instanceName);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const res = await fetch(`${base()}/instance/create`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeader() },
      body: JSON.stringify({ instanceName, qrcode: true, integration: "WHATSAPP-BAILEYS" }),
      signal: controller.signal,
    });
    if (res.ok) {
      const data = await res.json() as Record<string, unknown>;
      const apiKey = (data.hash as string) || "";
      const qrBase64 = normalizeQr(data.qrcode as Record<string, unknown> | undefined);
      if (qrBase64) {
        const code = (data.qrcode as Record<string, unknown> | undefined)?.code as string | undefined;
        setCachedQr(instanceName, qrBase64, code ?? "");
      }
      await setWebhook(instanceName, apiKey || adminKey(), webhookUrl);
      return { apiKey, qrBase64 };
    }
    // Instância já existe (nome em uso) — reinicia em vez de recriar.
    const body = await res.text().catch(() => "");
    console.warn(`[evolution-api] create FALHOU status=${res.status} instance=${instanceName} body=${body.slice(0, 300)} — tentando restart`);
    const restarted = await restartInstance(instanceName);
    if (!restarted) return null;
    // Sem "hash" novo disponível aqui — quem chamar deve manter a apiKey já
    // salva na sessão (EvolutionSession.instanceApiKey) nesse caso.
    await setWebhook(instanceName, adminKey(), webhookUrl);
    const qr = await getQrCode(instanceName);
    return { apiKey: "", qrBase64: qr };
  } catch (e) {
    console.error(`[evolution-api] createOrRestartInstance FALHOU/TIMEOUT instance=${instanceName}`, e);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ⚠️ NÃO TESTADO AO VIVO — endpoint de reinício documentado pela Evolution
// (POST /instance/restart/{instance}), usado como fallback quando a instância
// já existe. Confirmar comportamento real na primeira reconexão de teste.
export async function restartInstance(instanceName: string): Promise<boolean> {
  if (!base()) return false;
  try {
    const res = await fetch(`${base()}/instance/restart/${encodeURIComponent(instanceName)}`, {
      method: "POST",
      headers: authHeader(),
    });
    return res.ok;
  } catch (e) {
    console.error(`[evolution-api] restartInstance FALHOU instance=${instanceName}`, e);
    return false;
  }
}

// Confirmado ao vivo: POST /webhook/set/{instance}
// ⚠️ webhookBase64:true NÃO se refletiu no retorno em teste (voltou false) —
// não assumir que mídia chega inline em base64 no webhook; o parser da rota de
// webhook precisa ter um caminho defensivo (buscar mídia por id) além do inline.
export async function setWebhook(instanceName: string, instanceApiKey: string, webhookUrl: string): Promise<boolean> {
  if (!base()) return false;
  try {
    const res = await fetch(`${base()}/webhook/set/${encodeURIComponent(instanceName)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeader(instanceApiKey) },
      body: JSON.stringify({
        webhook: {
          url: webhookUrl,
          enabled: true,
          webhookByEvents: false,
          webhookBase64: true,
          events: ["QRCODE_UPDATED", "MESSAGES_UPSERT", "CONNECTION_UPDATE"],
        },
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error(`[evolution-api] setWebhook FALHOU status=${res.status} instance=${instanceName} body=${body.slice(0, 300)}`);
    }
    return res.ok;
  } catch (e) {
    console.error(`[evolution-api] setWebhook EXCEPTION instance=${instanceName}`, e);
    return false;
  }
}

// Retorna o QR como data-URI base64. Fonte primária: GET /instance/connect/{instance}
// (regenera QR para uma instância existente ainda não pareada) — endpoint não
// testado ao vivo nesta rodada de verificação (o QR do teste veio direto do
// create). Fallback: cache populado pelo create e pelo evento QRCODE_UPDATED.
export async function getQrCode(instanceName: string): Promise<string | null> {
  if (!base()) return getCachedQr(instanceName);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_000);
  try {
    const res = await fetch(`${base()}/instance/connect/${encodeURIComponent(instanceName)}`, {
      headers: authHeader(),
      cache: "no-store",
      signal: controller.signal,
    });
    if (!res.ok) return getCachedQr(instanceName);
    const data = await res.json() as Record<string, unknown>;
    // Candidatos observados na documentação/versões da Evolution: base64 direto,
    // ou aninhado em "qrcode". Tenta os dois antes de cair no cache.
    const qr = normalizeQr(data as Record<string, unknown>) ?? normalizeQr(data.qrcode as Record<string, unknown> | undefined);
    if (!qr) return getCachedQr(instanceName);
    return qr;
  } catch (e) {
    console.error(`[evolution-api] getQrCode FALHOU/TIMEOUT instance=${instanceName}`, e);
    return getCachedQr(instanceName);
  } finally {
    clearTimeout(timer);
  }
}

// Confirmado ao vivo: GET /instance/connectionState/{instance} → { instance: { instanceName, state } }
// state observado: "connecting". "open"/"close" são os valores documentados
// pela Evolution/Baileys para conectado/desconectado — normalizados abaixo
// para o mesmo vocabulário usado pelo WPPConnect (CONNECTED|QRCODE|DISCONNECTED).
export async function checkConnectionStatus(instanceName: string): Promise<string> {
  if (!base()) return "DISCONNECTED";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(`${base()}/instance/connectionState/${encodeURIComponent(instanceName)}`, {
      headers: authHeader(),
      cache: "no-store",
      signal: controller.signal,
    });
    if (!res.ok) return "UNKNOWN";
    const data = await res.json() as Record<string, unknown>;
    const inst = data.instance as Record<string, unknown> | undefined;
    const s = String(inst?.state ?? data.state ?? "").toUpperCase();
    if (s === "OPEN" || s === "CONNECTED") return "CONNECTED";
    if (s === "CONNECTING") return "QRCODE";
    if (s === "CLOSE" || s === "CLOSED" || s === "DISCONNECTED") return "DISCONNECTED";
    return s || "UNKNOWN";
  } catch {
    return "UNKNOWN";
  } finally {
    clearTimeout(timer);
  }
}

// Confirmado ao vivo: DELETE /instance/logout/{instance}
export async function logoutInstance(instanceName: string): Promise<void> {
  clearCachedQr(instanceName);
  if (!base()) return;
  try {
    await fetch(`${base()}/instance/logout/${encodeURIComponent(instanceName)}`, {
      method: "DELETE",
      headers: authHeader(),
    });
  } catch (e) {
    console.error(`[evolution-api] logoutInstance FALHOU instance=${instanceName}`, e);
  }
}

// Confirmado ao vivo: DELETE /instance/delete/{instance}
// A Evolution exige logout antes de deletar instâncias já conectadas alguma
// vez — por segurança sempre chamamos logout antes, igual ao closeSession+
// logoutSession do WPPConnect (no-op inofensivo em instância nunca conectada).
export async function deleteInstance(instanceName: string): Promise<boolean> {
  if (!base()) return false;
  await logoutInstance(instanceName);
  try {
    const res = await fetch(`${base()}/instance/delete/${encodeURIComponent(instanceName)}`, {
      method: "DELETE",
      headers: authHeader(),
    });
    return res.ok;
  } catch (e) {
    console.error(`[evolution-api] deleteInstance FALHOU instance=${instanceName}`, e);
    return false;
  }
}

// Normaliza número brasileiro para o formato que a Evolution espera no campo
// "number": dígitos com DDI, sem sufixo de JID (diferente do "@c.us" do WPPConnect).
function normalizeBrPhone(raw: string): string {
  let d = raw.replace(/@.*$/, "").replace(/\D/g, "");
  if (!d) return raw;
  if (d.startsWith("55")) {
    if (d.length === 12) d = d.slice(0, 4) + "9" + d.slice(4);
  } else {
    if (d.length === 10) d = "55" + d.slice(0, 2) + "9" + d.slice(2);
    if (d.length === 11) d = "55" + d;
  }
  return d;
}

// ⚠️ Formato do body ("number"/"text") baseado na convenção documentada da
// Evolution — não testado ao vivo (não havia número pareado nesta rodada de
// verificação). Confirmar assim que uma instância de teste estiver conectada;
// se 400, o fallback tenta o shape alternativo {number, textMessage:{text}}.
export async function sendText(
  instanceName: string,
  instanceApiKey: string,
  phone: string,
  message: string,
  isLid = false,
  // true quando `phone` já veio do remoteJid de uma mensagem recebida agora
  // (o número exato que o WhatsApp usou pra nos entregar a mensagem) — nesse
  // caso normalizeBrPhone pode inserir um 9º dígito indevido e mandar a
  // resposta pra um número diferente do que originou a conversa, sem erro
  // visível (a Evolution aceita o envio mesmo que o número não exista).
  skipNormalize = false,
): Promise<boolean> {
  if (!base()) return false;
  try {
    const isGroup = phone.endsWith("@g.us");
    const number = isGroup ? phone : (isLid || skipNormalize) ? phone.replace(/@.*/, "").replace(/\D/g, "") : normalizeBrPhone(phone);
    const phoneKey = number.replace(/@.*/, "").replace(/\D/g, "");
    markPhoneSending(phoneKey);
    markSent(phoneKey, message);

    const url = `${base()}/message/sendText/${encodeURIComponent(instanceName)}`;
    const headers = { "Content-Type": "application/json", ...authHeader(instanceApiKey) };
    let res = await fetch(url, { method: "POST", headers, body: JSON.stringify({ number, text: message }) });
    if (!res.ok && res.status >= 400 && res.status < 500) {
      const fallback = await fetch(url, { method: "POST", headers, body: JSON.stringify({ number, textMessage: { text: message } }) });
      if (fallback.ok) return true;
    }
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error(`[evolution-api] sendText FAILED status=${res.status} instance=${instanceName} number=${number} body=${body.slice(0, 300)}`);
    }
    return res.ok;
  } catch (e) {
    console.error(`[evolution-api] sendText EXCEPTION instance=${instanceName}`, e);
    return false;
  }
}

// Mesma detecção de MIME/extensão usada em wppconnect-api.ts — copiada aqui
// (não movida para um arquivo compartilhado nesta fase para não editar o
// arquivo do WPPConnect, tratado como referência somente-leitura).
function detectMime(url: string, contentType: string): { mime: string; ext: string; type: "image" | "video" | "audio" | "document" } {
  const ct = contentType.split(";")[0].trim().toLowerCase();
  if (ct && ct !== "application/octet-stream") {
    if (ct.startsWith("image/")) return { mime: ct, ext: ct.split("/")[1] ?? "jpg", type: "image" };
    if (ct.startsWith("video/")) return { mime: ct, ext: ct.split("/")[1] ?? "mp4", type: "video" };
    if (ct.startsWith("audio/")) return { mime: ct, ext: ct.split("/")[1] ?? "ogg", type: "audio" };
  }
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

// ⚠️ NÃO TESTADO AO VIVO — shape documentado: POST /message/sendMedia/{instance}
// {number, mediatype, media, caption, fileName} para imagem/vídeo/documento;
// POST /message/sendWhatsAppAudio/{instance} {number, audio} para áudio/voz.
export async function sendMedia(
  instanceName: string,
  instanceApiKey: string,
  phone: string,
  mediaUrl: string,
  caption?: string,
  isLid = false,
  skipNormalize = false,
): Promise<boolean> {
  if (!base()) return false;
  try {
    const isGroup = phone.endsWith("@g.us");
    const number = isGroup ? phone : (isLid || skipNormalize) ? phone.replace(/@.*/, "").replace(/\D/g, "") : normalizeBrPhone(phone);
    const phoneKey = number.replace(/@.*/, "").replace(/\D/g, "");
    markPhoneSending(phoneKey);
    if (caption?.trim()) markSent(phoneKey, caption.trim());

    const fileRes = await fetch(mediaUrl);
    if (!fileRes.ok) {
      console.error(`[evolution-api] sendMedia: falha ao baixar ${mediaUrl} status=${fileRes.status}`);
      return false;
    }
    const contentType = fileRes.headers.get("content-type") ?? "";
    const { mime, ext, type } = detectMime(mediaUrl, contentType);
    const buffer = await fileRes.arrayBuffer();
    const base64Data = Buffer.from(buffer).toString("base64");
    const headers = { "Content-Type": "application/json", ...authHeader(instanceApiKey) };

    if (type === "audio") {
      const res = await fetch(`${base()}/message/sendWhatsAppAudio/${encodeURIComponent(instanceName)}`, {
        method: "POST",
        headers,
        body: JSON.stringify({ number, audio: `data:${mime};base64,${base64Data}` }),
      });
      if (!res.ok) console.error(`[evolution-api] sendWhatsAppAudio FAILED status=${res.status} body=${await res.text().catch(() => "")}`);
      return res.ok;
    }

    const mediatype = type === "image" ? "image" : type === "video" ? "video" : "document";
    const res = await fetch(`${base()}/message/sendMedia/${encodeURIComponent(instanceName)}`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        number,
        mediatype,
        media: `data:${mime};base64,${base64Data}`,
        caption: caption ?? "",
        fileName: `file.${ext}`,
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error(`[evolution-api] sendMedia FAILED status=${res.status} body=${body.slice(0, 300)}`);
    }
    return res.ok;
  } catch (e) {
    console.error(`[evolution-api] sendMedia EXCEPTION instance=${instanceName}`, e);
    return false;
  }
}

// Igual a sendMedia, mas a partir de um base64 já resolvido (sem baixar de URL).
export async function sendMediaFromBase64(
  instanceName: string,
  instanceApiKey: string,
  phone: string,
  base64DataUri: string,
  mimeType: string,
  caption?: string,
  isLid = false,
  skipNormalize = false,
): Promise<boolean> {
  if (!base()) return false;
  try {
    const isGroup = phone.endsWith("@g.us");
    const number = isGroup ? phone : (isLid || skipNormalize) ? phone.replace(/@.*/, "").replace(/\D/g, "") : normalizeBrPhone(phone);
    const phoneKey = number.replace(/@.*/, "").replace(/\D/g, "");
    markPhoneSending(phoneKey);
    if (caption?.trim()) markSent(phoneKey, caption.trim());

    const rawExt = mimeType.split("/")[1]?.split(";")[0] ?? "bin";
    const ext = rawExt === "jpeg" ? "jpg" : rawExt;
    const type = mimeType.startsWith("image/") ? "image"
               : mimeType.startsWith("video/") ? "video"
               : mimeType.startsWith("audio/") ? "audio"
               : "document";
    const headers = { "Content-Type": "application/json", ...authHeader(instanceApiKey) };

    if (type === "audio") {
      const res = await fetch(`${base()}/message/sendWhatsAppAudio/${encodeURIComponent(instanceName)}`, {
        method: "POST",
        headers,
        body: JSON.stringify({ number, audio: base64DataUri }),
      });
      if (!res.ok) console.error(`[evolution-api] sendMediaFromBase64 sendWhatsAppAudio FAILED status=${res.status}`);
      return res.ok;
    }

    const mediatype = type === "image" ? "image" : type === "video" ? "video" : "document";
    const res = await fetch(`${base()}/message/sendMedia/${encodeURIComponent(instanceName)}`, {
      method: "POST",
      headers,
      body: JSON.stringify({ number, mediatype, media: base64DataUri, caption: caption ?? "", fileName: `file.${ext}` }),
    });
    if (!res.ok) console.error(`[evolution-api] sendMediaFromBase64 sendMedia FAILED status=${res.status}`);
    return res.ok;
  } catch (e) {
    console.error(`[evolution-api] sendMediaFromBase64 EXCEPTION instance=${instanceName}`, e);
    return false;
  }
}

// ⚠️ Best-effort / não confirmado nesta versão — se o endpoint não existir
// nesta instância, falha silenciosamente (mesmo padrão do WPPConnect: recurso
// "não-crítico", nunca deve bloquear o envio da mensagem em si).
export async function startTyping(instanceName: string, instanceApiKey: string, phone: string): Promise<void> {
  if (!base()) return;
  try {
    const number = normalizeBrPhone(phone);
    await fetch(`${base()}/chat/sendPresence/${encodeURIComponent(instanceName)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeader(instanceApiKey) },
      body: JSON.stringify({ number, presence: "composing" }),
    });
  } catch { /* ignora — não-crítico */ }
}

export async function stopTyping(instanceName: string, instanceApiKey: string, phone: string): Promise<void> {
  if (!base()) return;
  try {
    const number = normalizeBrPhone(phone);
    await fetch(`${base()}/chat/sendPresence/${encodeURIComponent(instanceName)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeader(instanceApiKey) },
      body: JSON.stringify({ number, presence: "paused" }),
    });
  } catch { /* ignora — não-crítico */ }
}

// ⚠️ Best-effort — a Evolution não documenta um equivalente direto e óbvio ao
// mark-unseen do WPPConnect; mantido como no-op até confirmarmos se existe
// endpoint equivalente nesta versão. Não bloqueia nenhum fluxo de envio.
export async function markUnseen(): Promise<void> {
  // Intencionalmente vazio nesta fase — ver comentário acima.
}

// ⚠️ NÃO TESTADO AO VIVO — baixa prioridade, implementar/testar por último.
export async function listGroups(instanceName: string, instanceApiKey: string): Promise<{ id: string; name: string }[]> {
  if (!base()) return [];
  try {
    const res = await fetch(`${base()}/group/fetchAllGroups/${encodeURIComponent(instanceName)}?getParticipants=false`, {
      headers: authHeader(instanceApiKey),
      cache: "no-store",
    });
    if (!res.ok) return [];
    const data = await res.json() as unknown;
    if (!Array.isArray(data)) return [];
    return (data as Record<string, unknown>[])
      .map((g) => ({ id: String(g.id ?? ""), name: String(g.subject ?? g.name ?? "Grupo sem nome") }))
      .filter((g) => g.id);
  } catch {
    return [];
  }
}

// ⚠️ NÃO TESTADO AO VIVO — resolução de LID pode não ter equivalente nesta
// versão da Evolution; retorna null defensivamente (mesmo contrato do WPPConnect).
export async function resolveContactPhone(): Promise<string | null> {
  return null;
}

// ⚠️ NÃO TESTADO AO VIVO — best-effort via endpoint de perfil de contato.
export async function getContactName(instanceName: string, instanceApiKey: string, phone: string): Promise<string | null> {
  if (!base()) return null;
  try {
    const res = await fetch(`${base()}/chat/fetchProfile/${encodeURIComponent(instanceName)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeader(instanceApiKey) },
      body: JSON.stringify({ number: normalizeBrPhone(phone) }),
    });
    if (!res.ok) return null;
    const data = await res.json() as Record<string, unknown>;
    const name = (data.name as string) || (data.pushName as string) || null;
    return name && name.trim() && !/^\d+$/.test(name.trim()) ? name.trim() : null;
  } catch {
    return null;
  }
}

// ⚠️ NÃO TESTADO AO VIVO — endpoint documentado da Evolution para obter mídia
// já decodificada em base64 pelo próprio servidor (evita reimplementar a
// decriptação HKDF/AES do protocolo Baileys, como o UazAPI exige). Caminho
// principal para mídia quando o webhook não entrega o base64 inline (ver nota
// em setWebhook — webhookBase64 não se refletiu no retorno em teste).
export async function getBase64FromMediaMessage(
  instanceName: string,
  instanceApiKey: string,
  messageId: string,
): Promise<{ base64: string; mimetype: string } | null> {
  if (!base()) return null;
  try {
    const res = await fetch(`${base()}/chat/getBase64FromMediaMessage/${encodeURIComponent(instanceName)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeader(instanceApiKey) },
      body: JSON.stringify({ message: { key: { id: messageId } }, convertToMp4: false }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error(`[evolution-api] getBase64FromMediaMessage FALHOU status=${res.status} instance=${instanceName} messageId=${messageId} body=${body.slice(0, 300)}`);
      return null;
    }
    const data = await res.json() as Record<string, unknown>;
    const base64 = (data.base64 as string) || null;
    const mimetype = (data.mimetype as string) || "";
    if (!base64) return null;
    return { base64, mimetype };
  } catch (e) {
    console.error(`[evolution-api] getBase64FromMediaMessage EXCEPTION instance=${instanceName} messageId=${messageId}`, e);
    return null;
  }
}

export async function listInstances(): Promise<Record<string, unknown>[]> {
  if (!base()) return [];
  try {
    const res = await fetch(`${base()}/instance/fetchInstances`, { headers: authHeader(), cache: "no-store" });
    if (!res.ok) return [];
    const data = await res.json() as unknown;
    return Array.isArray(data) ? data as Record<string, unknown>[] : [];
  } catch {
    return [];
  }
}

// Número real conectado à instância (ex: "554491056048") — a Evolution expõe
// isso em "ownerJid" na listagem de instâncias (confirmado ao vivo:
// {"ownerJid":"554491056048@s.whatsapp.net", ...}). Usado só pra exibição na
// UI (seletor "responder pelo número" etc.), nunca pra envio/lógica.
export async function getInstancePhone(instanceName: string): Promise<string | null> {
  if (!base()) return null;
  try {
    const res = await fetch(`${base()}/instance/fetchInstances?instanceName=${encodeURIComponent(instanceName)}`, {
      headers: authHeader(),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const data = await res.json() as unknown;
    const list = Array.isArray(data) ? data as Record<string, unknown>[] : [];
    const inst = list[0];
    const ownerJid = (inst?.ownerJid as string | undefined) ?? "";
    const digits = ownerJid.replace(/@.*/, "").replace(/\D/g, "");
    return digits || null;
  } catch {
    return null;
  }
}
