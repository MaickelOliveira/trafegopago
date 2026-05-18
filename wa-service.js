/**
 * Serviço WhatsApp multi-instância (porta 3002)
 * Suporta múltiplos números por funil — Baileys (QR) e Meta Cloud API
 */
const http = require("http");
const path = require("path");
const fs = require("fs");
const os = require("os");

const PORT = 3002;

// Detecta o IP interno do container para alcançar o Next.js independente da porta
function getContainerIP() {
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name]) {
      if (!iface.internal && iface.family === "IPv4") return iface.address;
    }
  }
  return "localhost";
}
const APP_PORT = process.env.PORT || 3000;
const PLATFORM_WEBHOOK = process.env.PLATFORM_WEBHOOK_URL ||
  `http://${getContainerIP()}:${APP_PORT}/api/whatsapp/webhook`;
const SESSIONS_DIR = path.join(__dirname, "data", "wa-sessions");
const FUNNELS_FILE = path.join(__dirname, "data", "funnels.json");

if (!fs.existsSync(SESSIONS_DIR)) fs.mkdirSync(SESSIONS_DIR, { recursive: true });

// Map: connectionId → { socket, qr, status, phone, name, funnelId, clientId, type }
const instances = new Map();

function loadFunnels() {
  try { return JSON.parse(fs.readFileSync(FUNNELS_FILE, "utf-8")); } catch { return []; }
}

// ── Baileys ────────────────────────────────────────────────────
async function startBaileys(connectionId, funnelId, clientId) {
  if (instances.get(connectionId)?.socket) return;
  const sessionDir = path.join(SESSIONS_DIR, connectionId);
  if (!fs.existsSync(sessionDir)) fs.mkdirSync(sessionDir, { recursive: true });

  const inst = { socket: null, qr: null, status: "connecting", phone: null, name: null, funnelId, clientId, type: "baileys" };
  instances.set(connectionId, inst);

  try {
    const { default: makeWASocket, useMultiFileAuthState, DisconnectReason,
            fetchLatestBaileysVersion, makeCacheableSignalKeyStore } = await import("@whiskeysockets/baileys");
    const { default: pino } = await import("pino");

    const logger = pino({ level: "silent" });
    const { state: authState, saveCreds } = await useMultiFileAuthState(sessionDir);
    const { version } = await fetchLatestBaileysVersion();

    console.log(`[WA:${connectionId}] Iniciando Baileys...`);

    const sock = makeWASocket({
      version, logger,
      auth: { creds: authState.creds, keys: makeCacheableSignalKeyStore(authState.keys, logger) },
      printQRInTerminal: false,
      browser: ["TráfegoPago CRM", "Chrome", "1.0"],
      syncFullHistory: false, generateHighQualityLinkPreview: false, connectTimeoutMs: 60000,
    });

    inst.socket = sock;

    sock.ev.on("creds.update", saveCreds);
    sock.ev.on("connection.update", ({ connection, lastDisconnect, qr }) => {
      const i = instances.get(connectionId); if (!i) return;
      if (qr) { i.qr = qr; i.status = "connecting"; console.log(`[WA:${connectionId}] QR gerado`); }
      if (connection === "open") {
        i.status = "connected"; i.qr = null;
        i.phone = sock.user?.id?.split(":")[0]?.split("@")[0] ?? null;
        i.name = sock.user?.name ?? null;
        console.log(`[WA:${connectionId}] Conectado: ${i.phone}`);
      }
      if (connection === "close") {
        const code = (lastDisconnect?.error)?.output?.statusCode;
        const loggedOut = code === DisconnectReason?.loggedOut;
        console.log(`[WA:${connectionId}] Desconectado (${code})`);
        i.socket = null; i.phone = null; i.name = null;
        i.status = loggedOut ? "disconnected" : "connecting";
        if (!loggedOut) setTimeout(() => startBaileys(connectionId, funnelId, clientId), 8000);
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
          const text = msg.message?.conversation || msg.message?.extendedTextMessage?.text ||
                       msg.message?.imageMessage?.caption || msg.message?.videoMessage?.caption || "";
          if (!text.trim()) continue;
          console.log(`[WA:${connectionId}] ${fromMe ? "→" : "←"} ${phone}: ${text.slice(0, 50)}`);
          await fetch(PLATFORM_WEBHOOK, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ phone, message: text, pushName, fromMe, baileysClientId: clientId, funnelId }),
          }).catch(e => console.error(`[WA:${connectionId}] Webhook erro:`, e));
        } catch (e) { console.error(`[WA:${connectionId}] Erro:`, e); }
      }
    });
  } catch (e) {
    console.error(`[WA:${connectionId}] Erro ao iniciar:`, e);
    const i = instances.get(connectionId);
    if (i) { i.status = "disconnected"; i.socket = null; setTimeout(() => startBaileys(connectionId, funnelId, clientId), 15000); }
  }
}

async function stopInstance(connectionId) {
  const inst = instances.get(connectionId); if (!inst) return;
  if (inst.socket) { try { await inst.socket.logout(); } catch { /**/ } }
  inst.socket = null; inst.status = "disconnected"; inst.qr = null;
  const sessionDir = path.join(SESSIONS_DIR, connectionId);
  try { fs.rmSync(sessionDir, { recursive: true, force: true }); fs.mkdirSync(sessionDir); } catch { /**/ }
  instances.delete(connectionId);
  console.log(`[WA:${connectionId}] Removido`);
}

async function sendViaBaileys(connectionId, phone, message) {
  const inst = instances.get(connectionId);
  if (!inst?.socket || inst.status !== "connected") throw new Error("Instância não conectada");
  const jid = phone.replace(/\D/g, "") + "@s.whatsapp.net";
  await inst.socket.sendMessage(jid, { text: message });
}

async function sendViaMeta(metaPhoneNumberId, metaToken, phone, message) {
  const res = await fetch(`https://graph.facebook.com/v19.0/${metaPhoneNumberId}/messages`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${metaToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", to: phone.replace(/\D/g, ""), type: "text", text: { body: message } }),
  });
  if (!res.ok) throw new Error(`Meta API erro: ${res.status} ${await res.text()}`);
}

// Reconecta sessões Baileys salvas ao iniciar
function loadSavedSessions() {
  try {
    const funnels = loadFunnels();
    for (const funnel of funnels) {
      for (const conn of (funnel.connections ?? [])) {
        if (conn.type === "baileys") {
          const sessionDir = path.join(SESSIONS_DIR, conn.id);
          if (fs.existsSync(path.join(sessionDir, "creds.json"))) {
            console.log(`[WA] Reconectando: ${conn.id}`);
            startBaileys(conn.id, funnel.id, funnel.clientId ?? "sem-cliente");
          }
        }
      }
    }
  } catch (e) { console.error("[WA] Erro ao carregar sessões:", e); }
}

// ── HTTP Server ────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }

  const url = new URL(req.url, "http://localhost");
  const parts = url.pathname.split("/").filter(Boolean);

  // GET /status — todas as instâncias { connectionId: { status, phone, qr } }
  if (req.method === "GET" && parts[0] === "status" && !parts[1]) {
    const all = {};
    for (const [id, i] of instances) all[id] = { status: i.status, phone: i.phone, name: i.name, hasQr: !!i.qr, type: i.type };
    res.writeHead(200); res.end(JSON.stringify(all)); return;
  }

  // GET /status/:connectionId
  if (req.method === "GET" && parts[0] === "status" && parts[1]) {
    const i = instances.get(parts[1]);
    res.writeHead(200); res.end(JSON.stringify(i
      ? { status: i.status, phone: i.phone, name: i.name, qr: i.qr, type: i.type }
      : { status: "disconnected", phone: null, name: null, qr: null }));
    return;
  }

  // POST /connect — { connectionId, funnelId, clientId, type: "baileys" | "meta", metaPhoneNumberId?, metaToken? }
  if (req.method === "POST" && parts[0] === "connect") {
    let body = ""; req.on("data", d => body += d);
    req.on("end", async () => {
      try {
        const { connectionId, funnelId, clientId, type, metaPhoneNumberId, metaToken } = JSON.parse(body);
        if (type === "meta") {
          // Meta API: só registra como "connected" se tiver token e phoneNumberId
          if (!metaPhoneNumberId || !metaToken) {
            res.writeHead(400); res.end(JSON.stringify({ error: "metaPhoneNumberId e metaToken obrigatórios" })); return;
          }
          instances.set(connectionId, { socket: null, qr: null, status: "connected", phone: metaPhoneNumberId, name: "Meta API", funnelId, clientId, type: "meta", metaPhoneNumberId, metaToken });
          console.log(`[WA:${connectionId}] Meta API configurada`);
        } else {
          startBaileys(connectionId, funnelId, clientId ?? "sem-cliente");
        }
        // Aguarda QR
        await new Promise(r => setTimeout(r, 3000));
        const i = instances.get(connectionId);
        res.writeHead(200); res.end(JSON.stringify({ ok: true, status: i?.status, qr: i?.qr ?? null }));
      } catch (e) { res.writeHead(500); res.end(JSON.stringify({ error: String(e) })); }
    });
    return;
  }

  // DELETE /disconnect/:connectionId
  if (req.method === "DELETE" && parts[0] === "disconnect" && parts[1]) {
    await stopInstance(parts[1]);
    res.writeHead(200); res.end(JSON.stringify({ ok: true })); return;
  }

  // POST /send — { connectionId?, phone, message, metaPhoneNumberId?, metaToken?, type? }
  if (req.method === "POST" && parts[0] === "send") {
    let body = ""; req.on("data", d => body += d);
    req.on("end", async () => {
      try {
        const { connectionId, phone, message, metaPhoneNumberId, metaToken, type } = JSON.parse(body);
        if (type === "meta" || metaPhoneNumberId) {
          await sendViaMeta(metaPhoneNumberId, metaToken, phone, message);
        } else if (connectionId) {
          await sendViaBaileys(connectionId, phone, message);
        } else {
          // Tenta qualquer instância conectada
          const conn = [...instances.values()].find(i => i.status === "connected" && i.type === "baileys");
          if (!conn?.socket) throw new Error("Nenhuma instância disponível");
          const jid = phone.replace(/\D/g, "") + "@s.whatsapp.net";
          await conn.socket.sendMessage(jid, { text: message });
        }
        res.writeHead(200); res.end(JSON.stringify({ ok: true }));
      } catch (e) { res.writeHead(500); res.end(JSON.stringify({ error: String(e) })); }
    });
    return;
  }

  // GET /qr/:connectionId — página HTML com QR
  if (req.method === "GET" && parts[0] === "qr" && parts[1]) {
    const i = instances.get(parts[1]);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    if (i?.status === "connected") { res.writeHead(200); res.end(`<html><body style="font-family:sans-serif;text-align:center;padding:60px"><h2 style="color:#25D366">✅ Conectado: +${i.phone}</h2></body></html>`); return; }
    const qr = i?.qr;
    res.writeHead(200);
    res.end(`<!DOCTYPE html><html><head><meta charset="utf-8"><meta http-equiv="refresh" content="30"><title>QR</title><script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"></script><style>body{font-family:sans-serif;text-align:center;padding:40px;background:#f5f5f5}#box{display:inline-block;background:#fff;padding:24px;border-radius:12px;box-shadow:0 2px 12px rgba(0,0,0,.12)}</style></head><body><h2>Escanear QR — ${parts[1]}</h2>${qr ? `<div id="box"><div id="qr"></div></div><p style="color:#888;margin-top:16px">WhatsApp Business → Aparelhos conectados → Vincular</p><script>new QRCode(document.getElementById("qr"),{text:${JSON.stringify(qr)},width:256,height:256})</script>` : `<p>Aguardando QR... <a href="">Atualizar</a></p>`}</body></html>`);
    return;
  }

  res.writeHead(404); res.end(JSON.stringify({ error: "Not found" }));
});

server.listen(PORT, () => {
  console.log(`[WA Service] Porta ${PORT} — multi-instância (Baileys + Meta API)`);
  loadSavedSessions();
});
