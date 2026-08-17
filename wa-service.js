/**
 * Serviço WhatsApp multi-instância (porta 3002)
 * Suporta múltiplos números por funil — Baileys (QR/código) e Meta Cloud API
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
const SERVER_SESSIONS_FILE = path.join(__dirname, "data", "server-whatsapp-sessions.json");

if (!fs.existsSync(SESSIONS_DIR)) fs.mkdirSync(SESSIONS_DIR, { recursive: true });

// Map: connectionId → { socket, qr, status, phone, name, funnelId, clientId, type }
const instances = new Map();

function loadFunnels() {
  try { return JSON.parse(fs.readFileSync(FUNNELS_FILE, "utf-8")); } catch { return []; }
}

function loadServerSessions() {
  try {
    const parsed = JSON.parse(fs.readFileSync(SERVER_SESSIONS_FILE, "utf-8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

function validConnectionId(value) {
  return typeof value === "string" && /^[a-zA-Z0-9_-]{1,100}$/.test(value);
}

function readJsonBody(req, maxBytes = 128 * 1024) {
  return new Promise((resolve, reject) => {
    let body = "";
    let settled = false;
    req.on("data", chunk => {
      if (settled) return;
      body += chunk;
      if (body.length > maxBytes) {
        settled = true;
        reject(new Error("Payload muito grande"));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (settled) return;
      settled = true;
      try { resolve(JSON.parse(body || "{}")); }
      catch { reject(new Error("JSON inválido")); }
    });
    req.on("error", error => {
      if (settled) return;
      settled = true;
      reject(error);
    });
  });
}

// ── Baileys ────────────────────────────────────────────────────
async function startBaileys(connectionId, funnelId, clientId, pairingPhone) {
  const current = instances.get(connectionId);
  if (current?.socket) {
    if (!pairingPhone) return current;
    if (current.status === "connected") throw new Error("Este WhatsApp já está conectado");
    const code = await current.socket.requestPairingCode(pairingPhone);
    current.pairingCode = code;
    return current;
  }
  const sessionDir = path.join(SESSIONS_DIR, connectionId);
  if (!fs.existsSync(sessionDir)) fs.mkdirSync(sessionDir, { recursive: true });

  const inst = { socket: null, qr: null, pairingCode: null, status: "connecting", phone: null, name: null, funnelId, clientId, type: "baileys" };
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
      const i = instances.get(connectionId); if (i !== inst) return;
      if (qr) { i.qr = qr; i.status = "connecting"; console.log(`[WA:${connectionId}] QR gerado`); }
      if (connection === "open") {
        i.status = "connected"; i.qr = null; i.pairingCode = null;
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
        if (!loggedOut) setTimeout(() => {
          if (instances.get(connectionId) === inst) {
            startBaileys(connectionId, funnelId, clientId).catch(error =>
              console.error(`[WA:${connectionId}] Falha ao reconectar:`, error)
            );
          }
        }, 8000);
      }
    });
    sock.ev.on("messages.upsert", async ({ messages, type }) => {
      if (type !== "notify") return;
      for (const msg of messages) {
        try {
          if (instances.get(connectionId) !== inst) continue;
          const originalJid = msg.key.remoteJid ?? "";
          const jid = originalJid.endsWith("@lid")
            ? (msg.key.remoteJidAlt ?? originalJid)
            : originalJid;
          if (jid.endsWith("@g.us") || jid.endsWith("@broadcast")) continue;
          const phone = jid.replace("@s.whatsapp.net", "").replace(/\D/g, "");
          const fromMe = msg.key.fromMe ?? false;
          const pushName = msg.pushName ?? phone;
          const rootContent = msg.message ?? {};
          const content = rootContent.ephemeralMessage?.message ||
                          rootContent.viewOnceMessage?.message ||
                          rootContent.viewOnceMessageV2?.message ||
                          rootContent;
          const text = content.conversation || content.extendedTextMessage?.text ||
                       content.imageMessage?.caption || content.videoMessage?.caption ||
                       (content.audioMessage ? "[Áudio recebido]" : "") ||
                       (content.imageMessage ? "[Imagem recebida]" : "") ||
                       (content.videoMessage ? "[Vídeo recebido]" : "") ||
                       (content.documentMessage ? `[Documento recebido: ${content.documentMessage.fileName || "arquivo"}]` : "") ||
                       (content.stickerMessage ? "[Figurinha recebida]" : "");
          if (!text.trim()) continue;

          console.log(`[WA:${connectionId}] ${fromMe ? "→" : "←"} ${phone}: ${text.slice(0, 50)}`);
          const response = await fetch(PLATFORM_WEBHOOK, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              phone,
              message: text,
              pushName,
              fromMe,
              instanceId: connectionId,
              instancePhone: instances.get(connectionId)?.phone,
              serverClientId: clientId,
              serverFunnelId: funnelId,
            }),
          });
          if (!response.ok) {
            console.error(`[WA:${connectionId}] Webhook respondeu HTTP ${response.status}`);
          }
        } catch (e) { console.error(`[WA:${connectionId}] Erro:`, e); }
      }
    });

    if (pairingPhone) {
      if (authState.creds.registered) {
        throw new Error("A sessão existente precisa ser desconectada antes de gerar outro código");
      }
      const code = await sock.requestPairingCode(pairingPhone);
      inst.pairingCode = code;
      console.log(`[WA:${connectionId}] Código de vinculação gerado`);
    }

    return inst;
  } catch (e) {
    console.error(`[WA:${connectionId}] Erro ao iniciar:`, e);
    const i = instances.get(connectionId);
    if (i === inst) {
      i.status = "disconnected";
      i.socket = null;
      setTimeout(() => {
        if (instances.get(connectionId) === inst) {
          startBaileys(connectionId, funnelId, clientId).catch(error =>
            console.error(`[WA:${connectionId}] Falha ao reiniciar:`, error)
          );
        }
      }, 15000);
    }
    if (pairingPhone) throw e;
  }
}

async function stopInstance(connectionId) {
  const inst = instances.get(connectionId);
  if (inst?.socket) { try { await inst.socket.logout(); } catch { /**/ } }
  if (inst) { inst.socket = null; inst.status = "disconnected"; inst.qr = null; inst.pairingCode = null; }
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
    const seen = new Set();
    for (const session of loadServerSessions()) {
      if (!validConnectionId(session.id)) continue;
      const sessionDir = path.join(SESSIONS_DIR, session.id);
      if (fs.existsSync(path.join(sessionDir, "creds.json"))) {
        seen.add(session.id);
        console.log(`[WA] Reconectando sessão do servidor: ${session.id}`);
        startBaileys(session.id, session.funnelId, session.clientId).catch(e =>
          console.error(`[WA:${session.id}] Falha ao reconectar:`, e)
        );
      }
    }

    // Compatibilidade com registros antigos que porventura tenham sido salvos
    // diretamente em funnels.json.
    const funnels = loadFunnels();
    for (const funnel of funnels) {
      for (const conn of (funnel.connections ?? [])) {
        if (conn.type === "baileys" && !seen.has(conn.id)) {
          const sessionDir = path.join(SESSIONS_DIR, conn.id);
          if (fs.existsSync(path.join(sessionDir, "creds.json"))) {
            console.log(`[WA] Reconectando: ${conn.id}`);
            startBaileys(conn.id, funnel.id, funnel.clientId ?? "sem-cliente").catch(e =>
              console.error(`[WA:${conn.id}] Falha ao reconectar:`, e)
            );
          }
        }
      }
    }
  } catch (e) { console.error("[WA] Erro ao carregar sessões:", e); }
}

// ── HTTP Server ────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  res.setHeader("Content-Type", "application/json");
  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }

  if (process.env.WA_SERVICE_SECRET && req.headers["x-wa-service-secret"] !== process.env.WA_SERVICE_SECRET) {
    res.writeHead(401); res.end(JSON.stringify({ error: "Não autorizado" })); return;
  }

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

  // POST /pairing-code — cria uma sessão no servidor e devolve o código que
  // deve ser informado no celular em WhatsApp > Aparelhos conectados.
  if (req.method === "POST" && parts[0] === "pairing-code") {
    try {
      const { connectionId, funnelId, clientId, phone, reset } = await readJsonBody(req);
      const digits = String(phone ?? "").replace(/\D/g, "");
      if (!validConnectionId(connectionId) || !funnelId || !clientId || digits.length < 10 || digits.length > 15) {
        res.writeHead(400); res.end(JSON.stringify({ error: "connectionId, funnelId, clientId e telefone com DDI são obrigatórios" })); return;
      }
      if (reset) await stopInstance(connectionId);
      const inst = await startBaileys(connectionId, funnelId, clientId, digits);
      if (!inst?.pairingCode) throw new Error("O WhatsApp não devolveu um código de vinculação");
      res.writeHead(200);
      res.end(JSON.stringify({ code: inst.pairingCode, status: inst.status }));
    } catch (e) {
      res.writeHead(500); res.end(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }));
    }
    return;
  }

  // POST /connect — { connectionId, funnelId, clientId, type: "baileys" | "meta", metaPhoneNumberId?, metaToken? }
  if (req.method === "POST" && parts[0] === "connect") {
    try {
        const { connectionId, funnelId, clientId, type, metaPhoneNumberId, metaToken } = await readJsonBody(req);
        if (!validConnectionId(connectionId)) {
          res.writeHead(400); res.end(JSON.stringify({ error: "connectionId inválido" })); return;
        }
        if (type === "meta") {
          // Meta API: só registra como "connected" se tiver token e phoneNumberId
          if (!metaPhoneNumberId || !metaToken) {
            res.writeHead(400); res.end(JSON.stringify({ error: "metaPhoneNumberId e metaToken obrigatórios" })); return;
          }
          instances.set(connectionId, { socket: null, qr: null, status: "connected", phone: metaPhoneNumberId, name: "Meta API", funnelId, clientId, type: "meta", metaPhoneNumberId, metaToken });
          console.log(`[WA:${connectionId}] Meta API configurada`);
        } else {
          await startBaileys(connectionId, funnelId, clientId ?? "sem-cliente");
        }
        // Aguarda QR
        await new Promise(r => setTimeout(r, 3000));
        const i = instances.get(connectionId);
        res.writeHead(200); res.end(JSON.stringify({ ok: true, status: i?.status, qr: i?.qr ?? null }));
      } catch (e) { res.writeHead(500); res.end(JSON.stringify({ error: String(e) })); }
    return;
  }

  // DELETE /disconnect/:connectionId
  if (req.method === "DELETE" && parts[0] === "disconnect" && parts[1]) {
    if (!validConnectionId(parts[1])) { res.writeHead(400); res.end(JSON.stringify({ error: "connectionId inválido" })); return; }
    await stopInstance(parts[1]);
    res.writeHead(200); res.end(JSON.stringify({ ok: true })); return;
  }

  // POST /send — { connectionId?, phone, message, metaPhoneNumberId?, metaToken?, type? }
  if (req.method === "POST" && parts[0] === "send") {
    try {
        const { connectionId, phone, message, metaPhoneNumberId, metaToken, type } = await readJsonBody(req);
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

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[WA Service] Porta ${PORT} (somente interno) — multi-instância (Baileys + Meta API)`);
  loadSavedSessions();
});
