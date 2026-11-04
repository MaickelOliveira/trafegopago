import type { ChatMessage } from "./conversations";
import { saveDecryptedMedia } from "./media-transcribe";

const MAX_MEDIA_BYTES = 25 * 1024 * 1024;
export function decodeChatMediaBase64(value: unknown): Buffer | undefined {
  if (typeof value !== "string" || value.length > Math.ceil(MAX_MEDIA_BYTES / 3) * 4 + 512) return;
  const encoded = value.replace(/^data:[^,]*;base64,/i, "").replace(/\s/g, "");
  if (!encoded || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded) || encoded.length % 4 === 1) return;
  const buffer = Buffer.from(encoded, "base64");
  return buffer.length && buffer.length <= MAX_MEDIA_BYTES ? buffer : undefined;
}

/** Archive the attachment independently of transcription, AI settings and direction. */
export async function chatMediaMessage(input: {
  role: ChatMessage["role"]; content: string; ts: number; type: "audio" | "image";
  messageId?: string; buffer?: Buffer; mimeType: string; phone: string; clientId: string; connId?: string;
}, persist: typeof saveDecryptedMedia = saveDecryptedMedia): Promise<ChatMessage> {
  const message: ChatMessage = { role: input.role, content: input.content, ts: input.ts, type: input.type, ...(input.messageId ? { messageId: input.messageId } : {}) };
  if (input.buffer) {
    try { message.mediaUrl = await persist(input.buffer, input.phone, input.ts, input.mimeType, input.clientId, input.connId); }
    catch { console.warn("[chat-media] Arquivo indisponível; mensagem preservada no histórico."); }
  }
  return message;
}
