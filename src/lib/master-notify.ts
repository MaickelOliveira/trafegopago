/**
 * sendMasterNotification
 *
 * Envia uma mensagem para o "número master" configurado nas Configurações Globais,
 * usando a "conexão master" (instância WhatsApp de qualquer cliente).
 *
 * Como funciona:
 *   - config.masterPhone  → número que RECEBE a mensagem (seu WhatsApp pessoal)
 *   - config.masterConnectionId → ID da FunnelConnection que ENVIA a mensagem
 *
 * Retorna true se enviou, false se não configurado ou falhou.
 */

import { getConfig } from "./clients";
import { getFunnels } from "./funnels";
import { sendText } from "./uazapi";

export async function sendMasterNotification(message: string): Promise<boolean> {
  const config = getConfig();

  const masterPhone = config.masterPhone?.replace(/\D/g, "");
  const masterConnectionId = config.masterConnectionId;

  if (!masterPhone || !masterConnectionId) {
    console.warn("[master] masterPhone ou masterConnectionId não configurado — notificação não enviada.");
    return false;
  }

  // Busca a conexão master em todos os funis
  const funnels = getFunnels();
  let masterToken: string | undefined;

  for (const funnel of funnels) {
    for (const conn of funnel.connections ?? []) {
      if (conn.id === masterConnectionId && conn.uazapiToken) {
        masterToken = conn.uazapiToken;
        break;
      }
    }
    if (masterToken) break;
  }

  if (!masterToken) {
    console.warn(`[master] Conexão master id=${masterConnectionId} não encontrada ou sem token.`);
    return false;
  }

  const ok = await sendText(masterToken, masterPhone, message);
  if (!ok) console.warn("[master] sendText falhou para o número master.");
  return ok;
}
