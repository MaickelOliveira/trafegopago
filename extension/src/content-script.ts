import { detectWhatsAppState, scanConversations } from "./whatsapp-dom-adapter";
import type { ContentToBackgroundMessage, ConversationUpdate } from "./types";

// Roda SÓ em web.whatsapp.com (ver manifest.json content_scripts.matches).
// Nunca lê cookies, localStorage, IndexedDB ou credenciais do WhatsApp.

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

// ── Detecção de mensagens novas ──────────────────────────────────────────
// Baseline: na primeira varredura depois de carregar, só REGISTRA o estado
// atual de cada conversa, sem enviar nada — evita "importar" retroativamente
// todo o histórico de conversas já existente assim que o usuário conecta.
// Só a partir da segunda varredura em diante, uma prévia de mensagem
// diferente da última vista vira um evento "new-messages".
let baselineReady = false;
const lastPreviewByKey = new Map<string, string>();
let pendingBatch: ConversationUpdate[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
const BATCH_DELAY_MS = 2000; // agrupa rajadas de mensagens chegando juntas numa só chamada

function rowKey(row: { phone: string | null; contactName: string | null }): string | null {
  return row.phone ?? row.contactName;
}

function flushBatch() {
  flushTimer = null;
  if (pendingBatch.length === 0) return;
  const items = pendingBatch;
  pendingBatch = [];
  const message: ContentToBackgroundMessage = { type: "new-messages", items };
  chrome.runtime.sendMessage(message).catch(() => {
    // Se falhar (service worker reiniciando), essas atualizações específicas
    // se perdem — a próxima mudança de prévia detectada reenvia o estado
    // atual mesmo assim, então não fica preso.
  });
}

function scanForNewMessages() {
  const rows = scanConversations();
  if (rows.length === 0) {
    if (baselineReady) {
      // Já tínhamos visto linhas antes e agora não vemos nenhuma — pode ser
      // só uma tela transitória (busca ativa, etc.), não loga como erro.
    }
    return;
  }

  for (const row of rows) {
    const key = rowKey(row);
    if (!key || row.lastMessagePreview === null) continue;

    const previous = lastPreviewByKey.get(key);
    lastPreviewByKey.set(key, row.lastMessagePreview);

    if (!baselineReady) continue; // primeira varredura: só grava o baseline, não reporta
    if (previous === row.lastMessagePreview) continue; // sem mudança

    pendingBatch.push(row);
  }

  if (!baselineReady) {
    baselineReady = true;
    return;
  }

  if (pendingBatch.length > 0 && !flushTimer) {
    flushTimer = setTimeout(flushBatch, BATCH_DELAY_MS);
  }
}

// WhatsApp Web dispara MUITAS mutações de DOM por segundo (indicador de
// digitando, presença, timestamps) — escanear todas as linhas da lista a
// cada uma seria pesado. Throttle: no máximo 1 varredura completa por
// segundo, mesmo com mutações mais frequentes que isso.
let scanThrottled = false;
function throttledScan() {
  if (scanThrottled) return;
  scanThrottled = true;
  setTimeout(() => { scanThrottled = false; }, 1000);
  reportState();
  scanForNewMessages();
}

// A UI do WhatsApp Web é uma SPA — muda de tela sem navegação de página,
// então observamos mutações do DOM em vez de só rodar uma vez no load.
const observer = new MutationObserver(throttledScan);
observer.observe(document.documentElement, { childList: true, subtree: true });

reportState();
scanForNewMessages();
