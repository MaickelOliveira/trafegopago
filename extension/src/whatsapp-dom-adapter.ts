import type { ConnectorState } from "./types";

/** Isola TODOS os seletores dependentes da estrutura do WhatsApp Web num só
 *  lugar — se o WhatsApp mudar o HTML, só este arquivo precisa de ajuste, e
 *  o resto da extensão continua funcionando com "não deu pra identificar o
 *  estado" em vez de quebrar silenciosamente.
 *
 *  Só detecção de estado de conexão (landmark de DOM, baixo risco/simples).
 *  Leitura de mensagens/nome de contato/telefone é feita por main-world.ts
 *  via @wppconnect/wa-js — o DOM da lista de conversas não expõe telefone de
 *  forma estável entre versões do WhatsApp Web pra servir de fonte confiável
 *  de identidade do lead (ver decisão registrada no histórico do projeto). */

const QR_CANVAS_SELECTOR = 'canvas[aria-label], div[data-testid="qrcode"]';
// Grid de conversas: WhatsApp Web expõe isso como landmark "region" com esse
// título em qualquer idioma configurado no navegador — mais estável que uma
// classe CSS gerada por build.
const CHAT_LIST_SELECTOR = 'div[aria-label="Chat list"], div[aria-label="Lista de conversas"], #pane-side';
const LOADING_SELECTOR = 'div[data-testid="startup"], div[data-icon="loading"]';

export type DetectionResult = { state: ConnectorState } | { state: null; reason: "unknown_structure" };

export function detectWhatsAppState(doc: Document = document): DetectionResult {
  try {
    if (doc.querySelector(CHAT_LIST_SELECTOR)) return { state: "connected" };
    if (doc.querySelector(QR_CANVAS_SELECTOR)) return { state: "waiting_qr" };
    if (doc.querySelector(LOADING_SELECTOR)) return { state: "waiting_qr" };
    // Nenhum dos landmarks conhecidos apareceu — não assume "desconectado"
    // (poderia ser uma tela intermediária que ainda não mapeamos); reporta
    // como estrutura desconhecida, o service worker decide o que fazer.
    return { state: null, reason: "unknown_structure" };
  } catch {
    return { state: null, reason: "unknown_structure" };
  }
}
