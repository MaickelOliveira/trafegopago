import type { ChatMessage } from "./conversations";
import { saveDecryptedMedia } from "./media-transcribe";
import { chatFileName } from "./chat-attachments";

export function findWhatsAppMessageObject(message: Record<string, unknown> | undefined, depth = 0): { type: string; obj: Record<string, unknown> } | null {
  if (!message || depth > 5) return null;
  for (const type of ["imageMessage", "videoMessage", "audioMessage", "documentMessage", "stickerMessage", "extendedTextMessage"]) {
    const obj = message[type];
    if (obj && typeof obj === "object" && !Array.isArray(obj)) return { type, obj: obj as Record<string, unknown> };
  }
  for (const type of ["documentWithCaptionMessage", "ephemeralMessage", "viewOnceMessage", "viewOnceMessageV2", "viewOnceMessageV2Extension"]) {
    const wrapper = message[type];
    if (wrapper && typeof wrapper === "object" && "message" in wrapper) {
      const nested = (wrapper as { message?: unknown }).message;
      if (nested && typeof nested === "object" && !Array.isArray(nested)) {
        const found = findWhatsAppMessageObject(nested as Record<string, unknown>, depth + 1);
        if (found) return found;
      }
    }
  }
  return null;
}

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
  role: ChatMessage["role"]; content: string; ts: number; type: "audio" | "image" | "document"; fileName?: unknown;
  messageId?: string; buffer?: Buffer; mimeType: string; phone: string; clientId: string; connId?: string;
}, persist: typeof saveDecryptedMedia = saveDecryptedMedia): Promise<ChatMessage> {
  const message: ChatMessage = { role: input.role, content: input.content, ts: input.ts, type: input.type, ...(input.messageId ? { messageId: input.messageId } : {}) };
  if (input.type === "document") {
    message.fileName = chatFileName(input.fileName);
    message.mimeType = input.mimeType.split(";")[0].trim().slice(0, 120);
    if (input.buffer) message.fileSize = input.buffer.length;
  }
  if (input.buffer) {
    try { message.mediaUrl = input.type === "document"
      ? await persist(input.buffer, input.phone, input.ts, input.mimeType, input.clientId, input.connId, "document")
      : await persist(input.buffer, input.phone, input.ts, input.mimeType, input.clientId, input.connId); }
    catch { console.warn("[chat-media] Arquivo indisponível; mensagem preservada no histórico."); }
  }
  return message;
}
