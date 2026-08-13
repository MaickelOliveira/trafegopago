import { on, loader, chat } from "@wppconnect/wa-js";

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
 * RISCO ACEITO EXPLICITAMENTE (ver docs/PRIVACY.md e a tela de consentimento
 * v4.0.0): ler o estado interno da aplicação é uma técnica não-oficial
 * (mesma categoria de risco da Evolution API/WPPConnect já usados na
 * plataforma) e pode, em tese, contribuir pra uma restrição da conta de
 * WhatsApp em uso — só que aqui o WhatsApp em risco é o do PRÓPRIO CLIENTE,
 * não um número dedicado da agência.
 *
 * A partir da v4.0.0, este arquivo também ENVIA mensagem — resposta
 * automática do Agente IA (ver `chat.sendTextMessage` abaixo). Diferente de
 * leitura passiva, envio automatizado é exatamente o padrão que sistemas de
 * detecção de bot do WhatsApp mais observam — risco mais sério, aceito
 * explicitamente pelo usuário (ver histórico de decisão). `sendTextMessage`
 * é a ÚNICA função de escrita/automação chamada em toda a extensão — tudo o
 * mais (incluindo o resto deste arquivo) continua exclusivamente leitura,
 * apesar do pacote @wppconnect/wa-js ser monolítico e trazer bem mais
 * capacidade do que isso (não dá pra importar só uma função sem trazer o
 * resto do bundle).
 *
 * Nunca lê mídia (imagem/áudio/vídeo) nem histórico retroativo — só o texto
 * de mensagens novas que chegam a partir de agora, mesmo escopo mínimo que
 * o adapter de DOM sempre teve. Nunca envia mídia — só texto.
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
// Marcadores de origem distintos por direção — evita main-world processar
// por engano uma mensagem que ele mesmo postou (window.postMessage é
// recebido pelo próprio remetente também) ou confundir os dois sentidos.
const MAIN_WORLD_SOURCE = "conector-whatsapp-main-world";
const ISOLATED_SOURCE = "conector-whatsapp-isolated";

function postToIsolatedWorld(payload: Record<string, unknown>) {
  try {
    window.postMessage({ source: MAIN_WORLD_SOURCE, ...payload }, window.location.origin);
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
          // "@lid" é um identificador opaco interno do WhatsApp (protocolo mais
          // novo), não o telefone real — a parte numérica extraída dele NÃO é
          // discável. Reporta o tipo pro backend marcar isLid (mesmo campo que
          // o webhook Evolution já usa), em vez de tratar como telefone normal.
          const isLid = fromJid.endsWith("@lid");

          const contactName = typeof msg.notifyName === "string" && msg.notifyName.trim() ? msg.notifyName.trim() : null;
          const ts = typeof msg.t === "number" && msg.t > 0 ? msg.t * 1000 : Date.now();

          postToIsolatedWorld({
            type: "whatsapp-message",
            phone,
            chatId: fromJid,
            isLid,
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

    // ── Envio da resposta da IA (única escrita de toda a extensão) ──────────
    // content-script.ts busca respostas pendentes no servidor e manda um
    // comando aqui via postMessage (os dois mundos não compartilham escopo).
    window.addEventListener("message", (event) => {
      if (event.source !== window || event.origin !== window.location.origin) return;
      const data = event.data as { source?: string; type?: string; chatId?: string; text?: string; requestId?: string } | undefined;
      if (data?.source !== ISOLATED_SOURCE || data.type !== "send-reply") return;
      const { chatId, text, requestId } = data;
      if (!chatId || !text || !requestId) return;

      chat.sendTextMessage(chatId, text)
        .then(() => {
          postToIsolatedWorld({ type: "send-result", requestId, ok: true });
        })
        .catch((err: unknown) => {
          const message = err instanceof Error ? err.message : String(err);
          postToIsolatedWorld({ type: "send-result", requestId, ok: false, error: message });
        });
    });
  });
} catch {
  // wa-js não conseguiu nem inicializar — mesma lógica de degradação graciosa.
}
