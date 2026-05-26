/**
 * Faz download e descriptografia de mídia do WhatsApp (AES-256-CBC + HKDF),
 * depois transcreve/descreve via Gemini.
 *
 * O WhatsApp criptografa toda a mídia armazenada na CDN (mmg.whatsapp.net).
 * A chave de descriptografia (mediaKey) é enviada no payload do webhook.
 */
import { createDecipheriv, hkdfSync } from "crypto";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import path from "path";
import { GoogleGenerativeAI } from "@google/generative-ai";

const MEDIA_DIR = path.join(process.cwd(), "data", "media");

function ensureMediaDir() {
  if (!existsSync(MEDIA_DIR)) mkdirSync(MEDIA_DIR, { recursive: true });
}

/**
 * Salva o buffer descriptografado em disco e retorna a URL relativa para servir via API.
 * Ex: /api/media/5511999991234-1748278800000.ogg
 */
export function saveDecryptedMedia(buffer: Buffer, phone: string, ts: number, mimeType: string): string {
  ensureMediaDir();
  const ext = mimeType.includes("mp4") || mimeType.includes("video") ? "mp4"
    : mimeType.includes("webp") ? "webp"
    : mimeType.includes("jpeg") || mimeType.includes("jpg") ? "jpg"
    : mimeType.includes("png") ? "png"
    : "ogg";
  const safePhone = phone.replace(/\D/g, "");
  const filename = `${safePhone}-${ts}.${ext}`;
  writeFileSync(path.join(MEDIA_DIR, filename), buffer);
  return `/api/media/${filename}`;
}

export type MediaKind = "audio" | "image" | "video";

/**
 * Retorna a string de info HKDF correta para cada tipo de mídia do WhatsApp.
 * Referência: https://scontent.whatsapp.net/v/t62.7117-24/...
 */
function hkdfInfoString(mediaType: string): string {
  const lower = mediaType.toLowerCase();
  if (lower === "ptt" || lower === "audio" || lower.includes("audio")) return "WhatsApp Audio Keys";
  if (lower === "image" || lower.includes("image")) return "WhatsApp Image Keys";
  if (lower === "video" || lower.includes("video")) return "WhatsApp Video Keys";
  if (lower === "document" || lower.includes("document")) return "WhatsApp Document Keys";
  if (lower === "sticker") return "WhatsApp Image Keys";
  return "WhatsApp Audio Keys";
}

/**
 * Baixa o arquivo criptografado da CDN do WhatsApp e o descriptografa com HKDF + AES-256-CBC.
 * Retorna null se qualquer etapa falhar.
 */
export async function downloadAndDecryptMedia(
  encryptedUrl: string,
  mediaKeyBase64: string,
  mediaType: string,
): Promise<Buffer | null> {
  if (!encryptedUrl || !mediaKeyBase64) {
    console.log("[media-decrypt] URL ou mediaKey ausentes — skipping");
    return null;
  }

  try {
    // 1. Download do arquivo criptografado
    const res = await fetch(encryptedUrl, {
      headers: { "User-Agent": "WhatsApp/2.24.10.0" },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) {
      console.error(`[media-decrypt] HTTP ${res.status} ao baixar mídia de ${encryptedUrl.slice(0, 80)}`);
      return null;
    }
    const encryptedData = Buffer.from(await res.arrayBuffer());
    console.log(`[media-decrypt] Baixou ${encryptedData.length} bytes, mediaType=${mediaType}`);

    // 2. Derivação HKDF: mediaKey → iv (16) | cipherKey (32) | macKey (32) | refKey (32)
    const mediaKey = Buffer.from(mediaKeyBase64, "base64");
    const info = Buffer.from(hkdfInfoString(mediaType));
    const derived = Buffer.from(hkdfSync("sha256", mediaKey, Buffer.alloc(0), info, 112));
    const iv         = derived.subarray(0, 16);
    const cipherKey  = derived.subarray(16, 48);

    // 3. Remove os 10 bytes finais (HMAC-SHA256) e descriptografa
    const encContent = encryptedData.subarray(0, encryptedData.length - 10);
    const decipher = createDecipheriv("aes-256-cbc", cipherKey, iv);
    decipher.setAutoPadding(true);
    const decrypted = Buffer.concat([decipher.update(encContent), decipher.final()]);
    console.log(`[media-decrypt] Descriptografado: ${decrypted.length} bytes`);
    return decrypted;
  } catch (err) {
    console.error("[media-decrypt] Erro:", err instanceof Error ? err.message : String(err));
    return null;
  }
}

/** Remove codec/params do mimeType: "audio/ogg; codecs=opus" → "audio/ogg" */
function cleanMime(mime: string): string {
  return mime.split(";")[0].trim() || "audio/ogg";
}

/**
 * Envia a mídia descriptografada ao Gemini e retorna a transcrição/descrição.
 * Usa a API inline (base64) — adequado para arquivos até ~20 MB.
 */
export async function transcribeMedia(
  mediaBuffer: Buffer,
  rawMimeType: string,
  apiKey: string,
  kind: MediaKind,
): Promise<string | null> {
  const mimeType = cleanMime(rawMimeType);
  const base64 = mediaBuffer.toString("base64");

  const prompts: Record<MediaKind, string> = {
    audio: "Transcreva o áudio exatamente como falado, em português. Retorne apenas a transcrição literal, sem comentários ou formatação adicional.",
    image: "Descreva o conteúdo desta imagem em português. Se houver texto, transcreva-o integralmente.",
    video: "Descreva o conteúdo deste vídeo em português. Se houver fala ou texto visível, transcreva.",
  };

  const genAI = new GoogleGenerativeAI(apiKey);
  const modelsToTry = [
    "gemini-2.5-flash-preview-05-20",
    "gemini-2.5-flash",
    "gemini-2.0-flash",
    "gemini-1.5-flash",
  ];

  for (const modelId of modelsToTry) {
    try {
      const model = genAI.getGenerativeModel({ model: modelId });
      const result = await model.generateContent([
        { inlineData: { mimeType, data: base64 } },
        { text: prompts[kind] },
      ]);
      const text = result.response.text().trim();
      if (text) {
        console.log(`[media-transcribe] ${modelId} → "${text.slice(0, 120)}"`);
        return text;
      }
    } catch (err) {
      console.error(`[media-transcribe] ${modelId} falhou:`, err instanceof Error ? err.message : String(err));
    }
  }
  return null;
}
