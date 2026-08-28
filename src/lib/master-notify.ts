/**
 * sendMasterNotification
 *
 * Envia uma mensagem de sistema para o "número master" configurado nas Configurações Globais.
 *
 * Comportamento por tipo de conexão:
 *   - UazAPI → A IA compõe a mensagem livremente (parâmetro `message`)
 *   - API Oficial (Meta) → Usa template pré-aprovado; `message` é ignorado.
 *     Passa `metaTemplateName` e `language` para sobrescrever os valores do config.
 *
 * Retorna true se enviou, false se não configurado ou falhou.
 */

import { getConfig } from "./clients";
import { getFunnels } from "./funnels";
import { sendText } from "./uazapi";
import { sendTemplate } from "./waba-templates";
import { addMessage } from "./conversations";

interface MetaOverride {
  /** Nome do template aprovado (sobrescreve config.masterMetaTemplateBriefing) */
  templateName?: string;
  /** Código de idioma (sobrescreve config.masterMetaLanguage) */
  language?: string;
  /** Componentes do template (variáveis, botões, etc.) */
  components?: object[];
}

export async function sendMasterNotification(
  message: string,
  metaOverride?: MetaOverride,
): Promise<boolean> {
  const config = getConfig();

  const masterPhone = config.masterPhone?.replace(/\D/g, "");
  const masterConnectionId = config.masterConnectionId;

  if (!masterPhone || !masterConnectionId) {
    console.warn("[master] masterPhone ou masterConnectionId não configurado — notificação não enviada.");
    return false;
  }

  // Busca a conexão master em todos os funis
  const funnels = getFunnels();
  let found: {
    type: "uazapi" | "meta";
    uazapiToken?: string;
    metaPhoneNumberId?: string;
    metaToken?: string;
  } | undefined;

  for (const funnel of funnels) {
    for (const conn of funnel.connections ?? []) {
      if (conn.id === masterConnectionId) {
        found = {
          type: conn.type as "uazapi" | "meta",
          uazapiToken: conn.uazapiToken,
          metaPhoneNumberId: conn.metaPhoneNumberId,
          metaToken: conn.metaToken,
        };
        break;
      }
    }
    if (found) break;
  }

  if (!found) {
    console.warn(`[master] Conexão master id=${masterConnectionId} não encontrada.`);
    return false;
  }

  // ── UazAPI: mensagem livre composta pela IA ──
  if (found.type === "uazapi") {
    if (!found.uazapiToken) {
      console.warn("[master] Conexão UazAPI sem token.");
      return false;
    }
    const ok = await sendText(found.uazapiToken, masterPhone, message);
    if (!ok) console.warn("[master] sendText UazAPI falhou para o número master.");
    // Registra no histórico pra aparecer no Inbox da plataforma — sendText
    // aqui é a função "crua" do provider (uazapi.ts), que não loga sozinha,
    // diferente da facade em whatsapp.ts usada pelo restante do sistema.
    if (ok) addMessage(masterPhone, { role: "assistant", content: message, ts: Date.now() }, null);
    return ok;
  }

  // ── Meta API Oficial: template pré-aprovado ──
  if (found.type === "meta") {
    if (!found.metaPhoneNumberId || !found.metaToken) {
      console.warn("[master] Conexão Meta sem phoneNumberId ou token.");
      return false;
    }

    const templateName =
      metaOverride?.templateName ??
      config.masterMetaTemplateBriefing ??
      "";

    const language =
      metaOverride?.language ??
      config.masterMetaLanguage ??
      "pt_BR";

    if (!templateName) {
      console.warn("[master] Nenhum template configurado para notificação via API Oficial.");
      return false;
    }

    const result = await sendTemplate(
      found.metaPhoneNumberId,
      found.metaToken,
      masterPhone,
      templateName,
      language,
      metaOverride?.components,
    );

    if (!result.success) {
      console.warn("[master] sendTemplate Meta falhou:", result.error);
    } else {
      // Loga o "message" descritivo passado pelo chamador — o conteúdo real
      // enviado é o template fixo, mas isso já dá contexto legível no Inbox.
      addMessage(masterPhone, { role: "assistant", content: message, ts: Date.now() }, null);
    }
    return result.success;
  }

  return false;
}
