import { detectWhatsAppState } from "./whatsapp-dom-adapter";
import type { ContentToBackgroundMessage, IncomingMessage } from "./types";

// Roda SÓ em web.whatsapp.com (ver manifest.json content_scripts.matches),
// no mundo ISOLADO (padrão de content script) — só lê o DOM renderizado pra
// detectar estado de conexão. Nunca lê cookies, localStorage, IndexedDB ou
// credenciais do WhatsApp.

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
  const message: ContentToBackgroundMessage = { type: "new-messages", items };
  chrome.runtime.sendMessage(message).catch(() => {
    // Se falhar (service worker reiniciando), esse lote específico se perde
    // — a próxima mensagem detectada gera um novo lote, não fica preso.
  });
}

window.addEventListener("message", (event) => {
  if (event.source !== window || event.origin !== window.location.origin) return;
  const data = event.data as { source?: string; type?: string } | undefined;
  if (data?.source !== "conector-whatsapp-main-world" || data.type !== "whatsapp-message") return;

  const { phone, contactName, body, ts, adId, adSourceUrl, adTitle } = event.data as Record<string, unknown>;
  if (typeof phone !== "string" || typeof body !== "string") return;

  pendingBatch.push({
    phone,
    contactName: typeof contactName === "string" ? contactName : null,
    body,
    ts: typeof ts === "number" ? ts : Date.now(),
    adId: typeof adId === "string" ? adId : null,
    adSourceUrl: typeof adSourceUrl === "string" ? adSourceUrl : null,
    adTitle: typeof adTitle === "string" ? adTitle : null,
  });

  if (!flushTimer) flushTimer = setTimeout(flushBatch, BATCH_DELAY_MS);
});
