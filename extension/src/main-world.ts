// @wppconnect/wa-js NÃO é um módulo ESM/CJS de verdade apesar do .d.ts sugerir
// isso — o arquivo que o "exports" do package.json realmente aponta
// (dist/wppconnect-wa.js) é um bundle Webpack autoexecutável feito pra ser
// injetado como <script> solto (uso tradicional: Tampermonkey/Playwright), e
// só faz `self.WPP = <tudo>` no final. `import { on, loader, chat } from
// "@wppconnect/wa-js"` compila e passa no typecheck (o .d.ts existe), mas em
// tempo de execução TODOS os named imports vêm `undefined` — confirmado ao
// vivo (TypeError: Cannot read properties of undefined (reading
// 'onFullReady')). Import só pelo efeito colateral (executa o bundle, que
// seta o global) e usa a variável global de verdade.
import "@wppconnect/wa-js";

type WppGlobal = {
  on: (event: string, listener: (msg: unknown) => void) => void;
  loader: {
    isFullReady: boolean;
    onFullReady: (listener: () => void, delay?: number) => void;
  };
  chat: {
    sendTextMessage: (chatId: string, content: string) => Promise<unknown>;
  };
  contact: {
    // Consulta o mapeamento LID↔telefone que o próprio WhatsApp Web mantém
    // internamente (sem isso, um contato "@lid" só expõe um identificador
    // opaco, nunca o número de telefone real). Nem todo contato resolve —
    // WhatsApp não expõe esse mapeamento pra todo mundo (ex: contas que
    // nunca compartilharam o número) — trata como "sem resolução" quando não vier.
    getPnLidEntry: (contactId: string) => Promise<{ phoneNumber?: { _serialized?: string } }>;
  };
};

declare const self: Window & typeof globalThis & { WPP?: WppGlobal };

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
  id?: { fromMe?: boolean; _serialized?: string };
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

// wa-js dispara "chat.new_message" mais de uma vez pra MESMA mensagem —
// confirmado ao vivo (dezenas de disparos repetidos pro mesmo contato,
// provavelmente re-sync interno do WhatsApp Web re-emitindo mensagens já
// processadas, não só chegada de verdade). Sem essa trava, cada repetição
// reprocessa (inclusive rechama getPnLidEntry) e manda de novo pro backend.
// Cap de tamanho pra não crescer sem limite numa aba que fica aberta o dia
// inteiro — descarta as entradas mais antigas quando estoura.
const MAX_PROCESSED_IDS = 2000;
const processedMsgIds = new Set<string>();
function alreadyProcessed(id: string): boolean {
  if (processedMsgIds.has(id)) return true;
  processedMsgIds.add(id);
  if (processedMsgIds.size > MAX_PROCESSED_IDS) {
    const oldest = processedMsgIds.values().next().value;
    if (oldest !== undefined) processedMsgIds.delete(oldest);
  }
  return false;
}

// Log de diagnóstico — deliberadamente sempre ligado (não é dado sensível,
// só confirma que este script rodou). content-script.ts (mundo isolado) é
// injetado separadamente e não prova que ESTE script (mundo principal)
// também carregou — sem esse log, "conectado" no popup pode enganar: o
// heartbeat passa pelo outro script, não por este.
console.log("[Conector WhatsApp] main-world.ts carregado — aguardando wa-js ficar pronto...");

const WPP = self.WPP;
if (!WPP) {
  console.error("[Conector WhatsApp] window.WPP não existe depois de importar @wppconnect/wa-js — o bundle pode ter mudado de formato numa atualização da lib.");
}

setTimeout(() => {
  if (!WPP?.loader.isFullReady) {
    console.warn("[Conector WhatsApp] wa-js ainda não ficou pronto depois de 20s — pode ser versão do WhatsApp Web incompatível com @wppconnect/wa-js.");
  }
}, 20000);

try {
  if (!WPP) throw new Error("WPP indisponível");
  const wpp = WPP; // narrowed pra WppGlobal (não-opcional) — preserva o tipo dentro dos closures abaixo

  wpp.loader.onFullReady(() => {
    console.log("[Conector WhatsApp] wa-js pronto — escutando mensagens novas.");
    try {
      wpp.on("chat.new_message", (rawMsg: unknown) => {
        const msg = rawMsg as IncomingMsg;
        // IIFE async — o event emitter do wa-js não espera retorno, e a
        // resolução de LID (getPnLidEntry) é assíncrona.
        (async () => {
        try {
          const fromMe = msg?.id?.fromMe === true;
          const msgId = msg?.id?._serialized;
          if (msgId && alreadyProcessed(msgId)) return; // wa-js re-disparou uma mensagem já vista
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
          // discável por si só. Tenta resolver o telefone de verdade via o
          // mapeamento LID↔telefone que o próprio WhatsApp Web mantém
          // internamente — nem sempre existe (conta que nunca compartilhou o
          // número), nesse caso segue sem realPhone, backend trata como LID puro.
          const isLid = fromJid.endsWith("@lid");
          let realPhone: string | null = null;
          if (isLid) {
            try {
              const entry = await wpp.contact.getPnLidEntry(fromJid);
              const resolvedJid = entry?.phoneNumber?._serialized;
              if (resolvedJid) realPhone = extractPhone(resolvedJid);
            } catch {
              // sem resolução — mensagem segue como LID puro, não trava nada
            }
          }

          const contactName = typeof msg.notifyName === "string" && msg.notifyName.trim() ? msg.notifyName.trim() : null;
          const ts = typeof msg.t === "number" && msg.t > 0 ? msg.t * 1000 : Date.now();

          console.log(`[Conector WhatsApp] mensagem capturada de ${phone}${isLid ? ` (lid${realPhone ? `, resolvido: ${realPhone}` : ""})` : ""}`);

          postToIsolatedWorld({
            type: "whatsapp-message",
            phone,
            chatId: fromJid,
            isLid,
            realPhone,
            contactName,
            body,
            ts,
            fromMe,
            adId: msg.ctwaContext?.sourceId ?? null,
            adSourceUrl: msg.ctwaContext?.sourceUrl ?? null,
            adTitle: msg.ctwaContext?.title ?? null,
          });
        } catch {
          // uma mensagem malformada não derruba o listener inteiro
        }
        })();
      });
    } catch (e) {
      // API de evento do wa-js não bateu com o esperado (versão do
      // WhatsApp Web pode ter mudado internamente) — o resto da extensão
      // (status de conexão) continua normal, mas loga pra não ficar
      // invisível numa investigação futura.
      console.error("[Conector WhatsApp] erro ao registrar listener de mensagem:", e);
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

      wpp.chat.sendTextMessage(chatId, text)
        .then(() => {
          postToIsolatedWorld({ type: "send-result", requestId, ok: true });
        })
        .catch((err: unknown) => {
          const message = err instanceof Error ? err.message : String(err);
          postToIsolatedWorld({ type: "send-result", requestId, ok: false, error: message });
        });
    });
  });
} catch (e) {
  // wa-js não conseguiu nem inicializar — degrada graciosamente, mas loga.
  console.error("[Conector WhatsApp] wa-js falhou ao inicializar:", e);
}
