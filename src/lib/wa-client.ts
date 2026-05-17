/* eslint-disable @typescript-eslint/no-explicit-any */
import path from "path";

const SESSION_DIR = path.join(process.cwd(), "data", "wa-session");

type WAStatus = "disconnected" | "connecting" | "connected";

const state = {
  socket: null as any,
  qr: null as string | null,
  status: "disconnected" as WAStatus,
  phone: null as string | null,
  name: null as string | null,
  initializing: false,
};

let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

export function getWAStatus() {
  return { status: state.status, qr: state.qr, phone: state.phone, name: state.name };
}

async function processIncoming(phone: string, text: string, pushName: string, fromMe: boolean) {
  if (!text.trim()) return;
  try {
    const { upsertLeadByPhone, getLeadByPhone } = await import("./leads");
    const { addMessage } = await import("./conversations");
    const { getConfig } = await import("./clients");

    const clientId = "nexo-pro";
    const isNew = !getLeadByPhone(clientId, phone);
    upsertLeadByPhone(clientId, phone, {
      clientId,
      funnelId: "default",
      source: "whatsapp",
      name: pushName || phone,
      ...(isNew ? { status: "entrada" } : {}),
    });

    addMessage(phone, { role: fromMe ? "assistant" : "user", content: text, ts: Date.now() }, clientId);

    const config = getConfig();
    if (!fromMe && config.uazapiWebhookForward) {
      fetch(config.uazapiWebhookForward, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, message: text, pushName, fromMe }),
      }).catch(() => {});
    }
  } catch (e) {
    console.error("[WA] processIncoming erro:", e);
  }
}

export async function sendWAMessage(phone: string, message: string): Promise<void> {
  if (!state.socket || state.status !== "connected") throw new Error("WhatsApp não conectado");
  const jid = phone.replace(/\D/g, "") + "@s.whatsapp.net";
  await state.socket.sendMessage(jid, { text: message });
}

export async function disconnectWhatsApp(): Promise<void> {
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  if (state.socket) {
    try { await state.socket.logout(); } catch { /* ignora */ }
    state.socket = null;
  }
  state.status = "disconnected";
  state.qr = null;
  state.phone = null;
  state.name = null;
  state.initializing = false;
}

export async function initWhatsApp(): Promise<void> {
  if (state.initializing || state.socket) return;
  state.initializing = true;

  try {
    const { default: makeWASocket, useMultiFileAuthState, DisconnectReason,
            fetchLatestBaileysVersion, makeCacheableSignalKeyStore } = await import("@whiskeysockets/baileys");
    const { default: pino } = await import("pino");
    const { Boom } = await import("@hapi/boom");

    const logger = pino({ level: "silent" });
    const { state: authState, saveCreds } = await useMultiFileAuthState(SESSION_DIR);
    const { version } = await fetchLatestBaileysVersion();

    state.status = "connecting";

    const sock = makeWASocket({
      version,
      logger,
      auth: {
        creds: authState.creds,
        keys: makeCacheableSignalKeyStore(authState.keys, logger),
      },
      printQRInTerminal: false,
      browser: ["TráfegoPago CRM", "Chrome", "1.0"],
      syncFullHistory: false,
      generateHighQualityLinkPreview: false,
      connectTimeoutMs: 30000,
    });

    state.socket = sock;

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("connection.update", ({ connection, lastDisconnect, qr }) => {
      if (qr) {
        state.qr = qr;
        state.status = "connecting";
        console.log("[WA] QR code gerado");
      }

      if (connection === "open") {
        state.status = "connected";
        state.qr = null;
        state.initializing = false;
        const me = sock.user;
        state.phone = me?.id?.split(":")[0]?.split("@")[0] ?? null;
        state.name = me?.name ?? null;
        console.log("[WA] Conectado:", state.phone);
      }

      if (connection === "close") {
        const code = (lastDisconnect?.error as { output?: { statusCode?: number } })?.output?.statusCode;
        const loggedOut = code === DisconnectReason.loggedOut;
        console.log("[WA] Desconectado, código:", code, "logout:", loggedOut);
        state.status = "disconnected";
        state.socket = null;
        state.phone = null;
        state.name = null;
        state.initializing = false;
        if (!loggedOut) {
          if (reconnectTimer) clearTimeout(reconnectTimer);
          reconnectTimer = setTimeout(() => initWhatsApp(), 8000);
        }
      }
    });

    sock.ev.on("messages.upsert", async ({ messages, type }) => {
      if (type !== "notify") return;
      for (const msg of messages) {
        try {
          const jid = msg.key.remoteJid ?? "";
          if (jid.endsWith("@g.us") || jid.endsWith("@broadcast")) continue;
          const phone = jid.replace("@s.whatsapp.net", "").replace(/\D/g, "");
          const fromMe = msg.key.fromMe ?? false;
          const pushName = msg.pushName ?? phone;
          const text =
            msg.message?.conversation ||
            msg.message?.extendedTextMessage?.text ||
            msg.message?.imageMessage?.caption ||
            msg.message?.videoMessage?.caption || "";
          if (text) await processIncoming(phone, text, pushName, fromMe);
        } catch (e) {
          console.error("[WA] Erro mensagem:", e);
        }
      }
    });

  } catch (e) {
    console.error("[WA] Erro ao inicializar Baileys:", e);
    state.status = "disconnected";
    state.initializing = false;
    // Tenta novamente em 15s
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(() => initWhatsApp(), 15000);
  }
}
