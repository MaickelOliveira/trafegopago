import { on, loader } from "@wppconnect/wa-js";

/**
 * ⚠️ Roda no MUNDO PRINCIPAL (MAIN world) da página do WhatsApp Web — ver
 * manifest.json content_scripts[1].world. Diferente de content-script.ts
 * (mundo isolado, só lê o DOM renderizado), este arquivo compartilha o
 * mesmo contexto JavaScript da própria aplicação do WhatsApp Web, porque só
 * assim é possível usar a lib @wppconnect/wa-js pra ler o estado interno já
 * decodificado de cada mensagem — telefone, nome e conteúdo confiáveis (o
 * DOM da lista de conversas não expõe isso de forma estável entre versões
 * do WhatsApp Web), além do contexto de anúncio de origem quando existe
 * (nunca desenhado em tela, ver whatsapp-dom-adapter.ts).
 *
 * RISCO ACEITO EXPLICITAMENTE (ver docs/AD_TRACKING_RISK.md e a tela de
 * consentimento v3.0.0): ler o estado interno da aplicação é uma técnica
 * não-oficial (mesma categoria de risco da Evolution API/WPPConnect já
 * usados na plataforma) e pode, em tese, contribuir pra uma restrição da
 * conta de WhatsApp em uso — só que aqui o WhatsApp em risco é o do
 * PRÓPRIO CLIENTE, não um número dedicado da agência.
 *
 * A lib @wppconnect/wa-js é monolítica — importar ela traz o pacote inteiro
 * (inclusive funções de envio de mensagem, grupos, etc.), não dá pra
 * importar só a parte de leitura de eventos. Este arquivo NUNCA chama
 * nenhuma função de envio/automação do pacote — só WPP.on(), que é
 * somente-leitura (escuta eventos, não dispara ação nenhuma no WhatsApp).
 *
 * Nunca lê mídia (imagem/áudio/vídeo) nem histórico retroativo — só o texto
 * de mensagens novas que chegam a partir de agora, mesmo escopo mínimo que
 * o adapter de DOM sempre teve.
 */

type Wid = { _serialized?: string };

type CtwaContext = {
  sourceId?: string;
  sourceUrl?: string;
  title?: string;
};

type IncomingMsg = {
  id?: { fromMe?: boolean };
  from?: Wid;
  body?: string;
  notifyName?: unknown;
  t?: number;
  ctwaContext?: CtwaContext;
};

const JID_PHONE_RE = /(\d{8,15})@(c\.us|s\.whatsapp\.net|lid)/;
const MESSAGE_SOURCE = "conector-whatsapp-main-world";

function postToIsolatedWorld(payload: Record<string, unknown>) {
  try {
    window.postMessage({ source: MESSAGE_SOURCE, type: "whatsapp-message", ...payload }, window.location.origin);
  } catch {
    // não deixa um erro de postMessage subir e quebrar o listener do wa-js
  }
}

function extractPhone(jid: string): string | null {
  return jid.match(JID_PHONE_RE)?.[1] ?? null;
}

try {
  loader.onFullReady(() => {
    try {
      on("chat.new_message", (msg: IncomingMsg) => {
        try {
          if (msg?.id?.fromMe) return; // mensagem enviada por nós, não pelo cliente/lead
          const fromJid = msg.from?._serialized ?? "";
          if (!fromJid || fromJid.endsWith("@g.us")) return; // ignora grupos — mesmo filtro do webhook Evolution

          // Sem corpo de texto (mídia sem legenda, figurinha, etc.) — nunca lê
          // mídia, então não tem o que reportar pra essa mensagem específica.
          const body = typeof msg.body === "string" ? msg.body.trim() : "";
          if (!body) return;

          const phone = extractPhone(fromJid);
          if (!phone) return; // JID em formato que não reconhecemos — não arrisca criar lead com chave errada

          const contactName = typeof msg.notifyName === "string" && msg.notifyName.trim() ? msg.notifyName.trim() : null;
          const ts = typeof msg.t === "number" && msg.t > 0 ? msg.t * 1000 : Date.now();

          postToIsolatedWorld({
            phone,
            contactName,
            body,
            ts,
            adId: msg.ctwaContext?.sourceId ?? null,
            adSourceUrl: msg.ctwaContext?.sourceUrl ?? null,
            adTitle: msg.ctwaContext?.title ?? null,
          });
        } catch {
          // uma mensagem malformada não derruba o listener inteiro
        }
      });
    } catch {
      // API de evento do wa-js não bateu com o esperado (versão do
      // WhatsApp Web pode ter mudado internamente) — falha silenciosa, o
      // resto da extensão (status de conexão) continua normal.
    }
  });
} catch {
  // wa-js não conseguiu nem inicializar — mesma lógica de degradação graciosa.
}
