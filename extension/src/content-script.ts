import { detectWhatsAppState } from "./whatsapp-dom-adapter";
import type { ContentToBackgroundMessage } from "./types";

// Roda SÓ em web.whatsapp.com (ver manifest.json content_scripts.matches).
// Nunca lê cookies, localStorage, IndexedDB ou qualquer conteúdo de
// conversa — só observa presença de elementos estruturais da página.

let lastReported: string | null = null;

function report() {
  const result = detectWhatsAppState();
  if (result.state === null) return; // estrutura não reconhecida — não reporta nada, não assume estado
  if (result.state === lastReported) return;
  lastReported = result.state;

  const message: ContentToBackgroundMessage = { type: "whatsapp-state", state: result.state };
  chrome.runtime.sendMessage(message).catch(() => {
    // Service worker pode estar dormindo/reiniciando — próxima mutação do
    // DOM tenta de novo, sem retry agressivo aqui.
  });
}

// A UI do WhatsApp Web é uma SPA — muda de tela sem navegação de página,
// então observamos mutações do DOM em vez de só rodar uma vez no load.
const observer = new MutationObserver(() => report());
observer.observe(document.documentElement, { childList: true, subtree: true });

report();
