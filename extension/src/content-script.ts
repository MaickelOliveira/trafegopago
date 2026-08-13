import { detectWhatsAppState } from "./whatsapp-dom-adapter";
import { PLATFORM_BASE_URL } from "./config";
import type { ContentToBackgroundMessage, IncomingMessage, PendingReply, StoredAuth } from "./types";

// Roda SÓ em web.whatsapp.com (ver manifest.json content_scripts.matches),
// no mundo ISOLADO (padrão de content script) — só lê o DOM renderizado pra
// detectar estado de conexão. Nunca lê cookies, localStorage, IndexedDB ou
// credenciais do WhatsApp.

const MAIN_WORLD_SOURCE = "conector-whatsapp-main-world";
const ISOLATED_SOURCE = "conector-whatsapp-isolated";

let lastReportedState: string | null = null;

function reportState() {
  const result = detectWhatsAppState();
  if (result.state === null) return; // estrutura não reconhecida — não reporta nada, não assume estado
  if (result.state === lastReportedState) return;
  lastReportedState = result.state;

  const message: ContentToBackgroundMessage = { type: "whatsapp-state", state: result.state };
  chrome.runtime.sendMessage(message).catch(() => {
    // Service worker pode estar dormindo/reiniciando — próxima mutação do
    // DOM tenta de novo, sem retry agressivo aqui.
  });
}

// WhatsApp Web dispara MUITAS mutações de DOM por segundo (indicador de
// digitando, presença, timestamps) — checar o estado a cada uma seria
// pesado. Throttle: no máximo 1 checagem por segundo, mesmo com mutações
// mais frequentes que isso.
let scanThrottled = false;
function throttledReportState() {
  if (scanThrottled) return;
  scanThrottled = true;
  setTimeout(() => { scanThrottled = false; }, 1000);
  reportState();
}

const observer = new MutationObserver(throttledReportState);
observer.observe(document.documentElement, { childList: true, subtree: true });

reportState();

// ── Mensagens novas (via main-world.ts) ──────────────────────────────────
// main-world.ts roda no mundo PRINCIPAL da página (compartilha contexto JS
// com o próprio WhatsApp Web) e lê o estado interno já decodificado de cada
// mensagem nova via @wppconnect/wa-js — muito mais confiável que raspar o
// DOM da lista de conversas (que não expõe telefone de forma estável). Os
// dois mundos não compartilham escopo, então a comunicação é via
// window.postMessage — só aceita eventos com a origem exata desta própria
// página e o marcador de fonte esperado, pra não processar mensagens de
// outro script qualquer rodando na mesma página.
let pendingBatch: IncomingMessage[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
const BATCH_DELAY_MS = 2000; // agrupa rajadas de mensagens chegando juntas numa só chamada

function flushBatch() {
  flushTimer = null;
  if (pendingBatch.length === 0) return;
  const items = pendingBatch;
  pendingBatch = [];
  console.log(`[Conector WhatsApp] mandando ${items.length} mensagem(ns) pro service worker`);
  const message: ContentToBackgroundMessage = { type: "new-messages", items };
  chrome.runtime.sendMessage(message).catch((e) => {
    // Se falhar (service worker reiniciando), esse lote específico se perde
    // — a próxima mensagem detectada gera um novo lote, não fica preso.
    console.warn("[Conector WhatsApp] falha ao mandar mensagem pro service worker:", e);
  });
}

// ── Resposta da IA: pede pro main-world enviar, pelo mesmo bridge ────────
// Correlaciona pedido↔resultado por requestId — postMessage é assíncrono e
// os dois mundos não compartilham nada além dessa troca de mensagens.
const pendingSendResolvers = new Map<string, (result: { ok: boolean; error?: string }) => void>();

function requestSend(chatId: string, text: string): Promise<{ ok: boolean; error?: string }> {
  return new Promise((resolve) => {
    const requestId = crypto.randomUUID();
    pendingSendResolvers.set(requestId, resolve);
    window.postMessage({ source: ISOLATED_SOURCE, type: "send-reply", chatId, text, requestId }, window.location.origin);
    // main-world pode nunca responder (wa-js travou, página mudou de estrutura) —
    // sem timeout, essa resposta pendente travaria o polling pra sempre.
    setTimeout(() => {
      if (pendingSendResolvers.has(requestId)) {
        pendingSendResolvers.delete(requestId);
        resolve({ ok: false, error: "timeout" });
      }
    }, 15000);
  });
}

window.addEventListener("message", (event) => {
  if (event.source !== window || event.origin !== window.location.origin) return;
  const data = event.data as Record<string, unknown> | undefined;
  if (data?.source !== MAIN_WORLD_SOURCE) return;

  if (data.type === "whatsapp-message") {
    const { phone, chatId, isLid, realPhone, contactName, body, ts, adId, adSourceUrl, adTitle } = data;
    if (typeof phone !== "string" || typeof chatId !== "string" || typeof body !== "string") return;

    pendingBatch.push({
      phone,
      chatId,
      isLid: isLid === true,
      realPhone: typeof realPhone === "string" ? realPhone : null,
      contactName: typeof contactName === "string" ? contactName : null,
      body,
      ts: typeof ts === "number" ? ts : Date.now(),
      adId: typeof adId === "string" ? adId : null,
      adSourceUrl: typeof adSourceUrl === "string" ? adSourceUrl : null,
      adTitle: typeof adTitle === "string" ? adTitle : null,
    });

    if (!flushTimer) flushTimer = setTimeout(flushBatch, BATCH_DELAY_MS);
    return;
  }

  if (data.type === "send-result") {
    const requestId = data.requestId;
    if (typeof requestId !== "string") return;
    const resolver = pendingSendResolvers.get(requestId);
    if (!resolver) return;
    pendingSendResolvers.delete(requestId);
    resolver({ ok: data.ok === true, error: typeof data.error === "string" ? data.error : undefined });
  }
});

// ── Busca respostas pendentes da IA e manda enviar ───────────────────────
// Fica no content-script (não no service worker) de propósito: content
// script não sofre a suspensão de service worker MV3 nem o piso de 1 min do
// chrome.alarms — fica vivo exatamente enquanto esta aba (única janela em
// que enviar é fisicamente possível) estiver aberta. Lê o token direto do
// storage, sem depender do service worker pra cada poll.
const POLL_INTERVAL_MS = 5000;
let pollInFlight = false;

async function pollPendingReplies() {
  if (pollInFlight) return;
  pollInFlight = true;
  try {
    const stored = await chrome.storage.local.get("auth");
    const auth = stored.auth as StoredAuth | undefined;
    if (!auth) return;

    const res = await fetch(`${PLATFORM_BASE_URL}/api/integrations/whatsapp-extension/pending-replies`, {
      headers: { Authorization: `Bearer ${auth.deviceToken}` },
    });
    if (!res.ok) return;
    const data = await res.json().catch(() => null) as { replies?: PendingReply[] } | null;
    if (!data?.replies?.length) return;

    for (const reply of data.replies) {
      const result = await requestSend(reply.chatId, reply.text);
      await fetch(`${PLATFORM_BASE_URL}/api/integrations/whatsapp-extension/pending-replies/ack`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${auth.deviceToken}` },
        body: JSON.stringify({ id: reply.id, ok: result.ok, error: result.error }),
      }).catch(() => {});
    }
  } catch {
    // rede instável — o próximo poll tenta de novo, nada fica preso
  } finally {
    pollInFlight = false;
  }
}

setInterval(pollPendingReplies, POLL_INTERVAL_MS);
pollPendingReplies();
