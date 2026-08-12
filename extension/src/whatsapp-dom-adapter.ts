import type { ConnectorState } from "./types";

/** Isola TODOS os seletores dependentes da estrutura do WhatsApp Web num só
 *  lugar — se o WhatsApp mudar o HTML, só este arquivo precisa de ajuste, e
 *  o resto da extensão continua funcionando com "não deu pra identificar o
 *  estado" em vez de quebrar silenciosamente.
 *
 *  Com o consentimento do usuário (ver EXTENSION_CONSENT_VERSION), este
 *  adaptador também lê nome de contato + prévia da última mensagem da LISTA
 *  de conversas, pra criar/atualizar leads no CRM — nunca abre uma conversa
 *  pra ler o histórico completo, nunca lê mídia, e nunca toca em
 *  cookies/localStorage/IndexedDB (autenticação do WhatsApp) em hipótese
 *  nenhuma. */

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

export type ConversationRow = {
  /** Telefone puro (só dígitos) quando dá pra extrair de um atributo
   *  data-id/JID da linha — nem sempre disponível (contatos salvos às vezes
   *  só expõem o nome no DOM). Nunca bloqueia o fluxo quando ausente: o
   *  backend usa o nome como fallback de identidade. */
  phone: string | null;
  contactName: string | null;
  lastMessagePreview: string | null;
};

// Linhas da lista de conversas: esse data-testid é o mais estável observado
// entre várias versões do WhatsApp Web (mais confiável que classes CSS
// geradas por build, que mudam a cada deploy). role="listitem" é o
// fallback semântico caso o testid mude.
const ROW_SELECTOR = '[data-testid="cell-frame-container"], #pane-side [role="listitem"]';
// Formato típico de JID individual: "5511999998888@c.us" ou variantes
// (@s.whatsapp.net, @lid) — extrai só a parte numérica.
const JID_PHONE_RE = /(\d{8,15})@(c\.us|s\.whatsapp\.net|lid)/;

function extractPhoneFromRow(row: Element): string | null {
  // O JID às vezes está num data-id da própria linha, às vezes num ancestral
  // próximo — sobe até 3 níveis procurando.
  let el: Element | null = row;
  for (let i = 0; i < 4 && el; i++) {
    const raw = el.getAttribute?.("data-id") ?? "";
    const match = raw.match(JID_PHONE_RE);
    if (match) return match[1] ?? null;
    el = el.parentElement;
  }
  return null;
}

function extractContactName(row: Element): string | null {
  // WhatsApp Web normalmente põe o nome completo no atributo title de um
  // span (o texto visível pode vir truncado com "..."), mais confiável que innerText.
  const titled = row.querySelector<HTMLElement>("span[title]");
  const fromTitle = titled?.getAttribute("title")?.trim();
  if (fromTitle) return fromTitle;
  // Fallback: primeiro span com texto não vazio.
  const spans = Array.from(row.querySelectorAll<HTMLElement>("span"));
  for (const s of spans) {
    const t = s.textContent?.trim();
    if (t) return t;
  }
  return null;
}

function extractLastMessagePreview(row: Element): string | null {
  // Prévia da mensagem costuma vir num span com dir="ltr" (texto direcional,
  // diferente do nome que não tem esse atributo). Fallback: segundo span com
  // texto (o primeiro geralmente é o nome).
  const preview = row.querySelector<HTMLElement>('span[dir="ltr"]');
  const fromDir = preview?.textContent?.trim();
  if (fromDir) return fromDir;
  const spans = Array.from(row.querySelectorAll<HTMLElement>("span")).filter((s) => s.textContent?.trim());
  return spans[1]?.textContent?.trim() ?? null;
}

/** Varre a lista de conversas visível — retorna [] (nunca lança) se a
 *  estrutura não bater com nenhum seletor conhecido, sinalizando pro
 *  content-script logar um aviso de "WhatsApp Web pode ter mudado". */
export function scanConversations(doc: Document = document): ConversationRow[] {
  try {
    const rows = doc.querySelectorAll(ROW_SELECTOR);
    const out: ConversationRow[] = [];
    rows.forEach((row) => {
      try {
        out.push({
          phone: extractPhoneFromRow(row),
          contactName: extractContactName(row),
          lastMessagePreview: extractLastMessagePreview(row),
        });
      } catch {
        // uma linha malformada não derruba a varredura inteira
      }
    });
    return out;
  } catch {
    return [];
  }
}
