import { NextRequest } from "next/server";
import { getDeviceByToken } from "@/lib/extension-devices";
import { getPendingReplies, markDelivered, markFailed } from "@/lib/extension-outbox";
import { addMessage } from "@/lib/conversations";
import { corsJson, corsOptionsResponse } from "@/lib/extension-cors";

function deviceToken(req: NextRequest): string | null {
  const header = req.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return null;
  return header.slice("Bearer ".length).trim();
}

/** Chamada pelo content-script depois de tentar enviar (ou falhar ao enviar)
 *  uma resposta pendente via wa-js. Só grava no histórico do Inbox depois de
 *  confirmado o envio de verdade — evita mensagem "fantasma" se a aba fechar
 *  antes de entregar. Chamada direto do content script — mesma exigência de
 *  CORS explícito de /pending-replies (ver src/lib/extension-cors.ts). */
export async function OPTIONS() {
  return corsOptionsResponse();
}

export async function POST(req: NextRequest) {
  const token = deviceToken(req);
  if (!token) return corsJson({ error: "Token ausente" }, { status: 401 });

  const device = getDeviceByToken(token);
  if (!device || device.status === "revoked") {
    return corsJson({ error: "Dispositivo não autorizado" }, { status: 401 });
  }

  const body = await req.json().catch(() => null) as { id?: string; ok?: boolean; error?: string } | null;
  if (!body?.id) return corsJson({ error: "id obrigatório" }, { status: 400 });

  // Confirma que essa resposta pendente é mesmo deste dispositivo antes de
  // marcar qualquer coisa — nunca confia só no id vindo do corpo da chamada.
  const owned = getPendingReplies(device.id).find((r) => r.id === body.id);
  if (!owned) return corsJson({ error: "Resposta pendente não encontrada" }, { status: 404 });

  if (body.ok) {
    markDelivered(owned.id);
    addMessage(owned.phone, { role: "assistant", content: owned.text, ts: Date.now() }, device.clientId, { connId: device.id });
  } else {
    markFailed(owned.id, body.error || "Erro desconhecido ao enviar");
  }

  return corsJson({ ok: true });
}
