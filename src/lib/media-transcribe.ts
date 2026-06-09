/**
 * Faz download e descriptografia de mídia do WhatsApp (AES-256-CBC + HKDF),
 * depois transcreve/descreve via Gemini.
 *
 * Para áudio usa a Gemini File API (GoogleAIFileManager) — mais confiável
 * para OGG/Opus do que inlineData base64.
 * Para imagem/vídeo/documento usa inlineData base64.
 */
import { createDecipheriv, hkdfSync } from "crypto";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import path from "path";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { GoogleAIFileManager, FileState } from "@google/generative-ai/server";

const MEDIA_DIR = path.join(process.cwd(), "data", "media");

function ensureMediaDir() {
  if (!existsSync(MEDIA_DIR)) mkdirSync(MEDIA_DIR, { recursive: true });
}

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

export type MediaKind = "audio" | "image" | "video" | "document";

function hkdfInfoString(mediaType: string): string {
  const lower = mediaType.toLowerCase();
  if (lower === "ptt" || lower === "audio" || lower.includes("audio")) return "WhatsApp Audio Keys";
  if (lower === "image" || lower.includes("image")) return "WhatsApp Image Keys";
  if (lower === "video" || lower.includes("video")) return "WhatsApp Video Keys";
  if (lower === "document" || lower.includes("document")) return "WhatsApp Document Keys";
  if (lower === "sticker") return "WhatsApp Image Keys";
  return "WhatsApp Audio Keys";
}

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
    const res = await fetch(encryptedUrl, {
      headers: { "User-Agent": "WhatsApp/2.24.10.0" },
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      console.error(`[media-decrypt] HTTP ${res.status} ao baixar mídia de ${encryptedUrl.slice(0, 80)}`);
      return null;
    }
    const encryptedData = Buffer.from(await res.arrayBuffer());
    console.log(`[media-decrypt] Baixou ${encryptedData.length} bytes, mediaType=${mediaType}`);

    const mediaKey = Buffer.from(mediaKeyBase64, "base64");
    const info = Buffer.from(hkdfInfoString(mediaType));
    const derived = Buffer.from(hkdfSync("sha256", mediaKey, Buffer.alloc(0), info, 112));
    const iv         = derived.subarray(0, 16);
    const cipherKey  = derived.subarray(16, 48);

    const encContent = encryptedData.subarray(0, encryptedData.length - 10);
    const decipher = createDecipheriv("aes-256-cbc", cipherKey, iv);
    decipher.setAutoPadding(true);
    const decrypted = Buffer.concat([decipher.update(encContent), decipher.final()]);
    // Primeiros bytes identificam o formato: OGG=4f676753 JPEG=ffd8ff PNG=89504e47
    console.log(`[media-decrypt] OK: ${decrypted.length} bytes, magic=${decrypted.subarray(0, 4).toString("hex")}`);
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
 * Faz upload do buffer para a Gemini File API via GoogleAIFileManager e
 * aguarda o estado ACTIVE. Retorna { uri, name } ou null.
 */
async function uploadAudioToFileAPI(
  buffer: Buffer,
  mimeType: string,
  apiKey: string,
): Promise<{ uri: string; name: string } | null> {
  try {
    const fileManager = new GoogleAIFileManager(apiKey);

    const uploadResult = await fileManager.uploadFile(buffer, {
      mimeType,
      displayName: `audio-${Date.now()}`,
    });

    const { name, uri } = uploadResult.file;
    let state = uploadResult.file.state;
    console.log(`[gemini-file-api] Upload OK: name=${name} state=${state} uri=${uri?.slice(0, 60)}`);

    // Aguarda processamento (tipicamente imediato para arquivos pequenos)
    let retries = 0;
    while (state === FileState.PROCESSING && retries < 15) {
      await new Promise<void>((r) => setTimeout(r, 2000));
      try {
        const updated = await fileManager.getFile(name);
        state = updated.state;
        console.log(`[gemini-file-api] Poll ${retries + 1}: state=${state}`);
      } catch { /* retry silently */ }
      retries++;
    }

    if (state === FileState.FAILED) {
      console.error("[gemini-file-api] Processing FAILED:", name);
      fileManager.deleteFile(name).catch(() => {});
      return null;
    }

    return { uri, name };
  } catch (err) {
    console.error("[gemini-file-api] Erro no upload:", err instanceof Error ? err.message : String(err));
    return null;
  }
}

export async function transcribeMedia(
  mediaBuffer: Buffer,
  rawMimeType: string,
  apiKey: string,
  kind: MediaKind,
): Promise<string | null> {
  const mimeType = cleanMime(rawMimeType);

  const prompts: Record<MediaKind, string> = {
    audio: "Transcreva o áudio exatamente como falado, em português. Retorne apenas a transcrição literal, sem comentários ou formatação adicional.",
    image: "Descreva o conteúdo desta imagem em português. Se houver texto, transcreva-o integralmente.",
    video: "Descreva o conteúdo deste vídeo em português. Se houver fala ou texto visível, transcreva.",
    document: "Descreva o conteúdo deste documento em português. Se houver texto, resuma os pontos principais.",
  };

  const genAI = new GoogleGenerativeAI(apiKey);
  const modelsToTry = [
    "gemini-2.5-flash",
    "gemini-2.0-flash",
    "gemini-1.5-flash",
  ];

  // ── Áudio: File API (upload + fileData URI) ────────────────────────────────
  // Google recomenda File API para áudio OGG/Opus do WhatsApp.
  if (kind === "audio") {
    console.log(`[media-transcribe] Áudio: usando File API (${mediaBuffer.length} bytes, mime=${mimeType})`);

    const fileInfo = await uploadAudioToFileAPI(mediaBuffer, mimeType, apiKey);

    if (fileInfo) {
      const fileManager = new GoogleAIFileManager(apiKey);
      for (const modelId of modelsToTry) {
        try {
          const model = genAI.getGenerativeModel({ model: modelId });
          const result = await model.generateContent([
            { fileData: { mimeType, fileUri: fileInfo.uri } },
            { text: prompts.audio },
          ]);
          const text = result.response.text().trim();
          if (text) {
            console.log(`[media-transcribe] File API + ${modelId} → "${text.slice(0, 120)}"`);
            fileManager.deleteFile(fileInfo.name).catch(() => {});
            return text;
          }
        } catch (err) {
          console.error(`[media-transcribe] File API + ${modelId} falhou:`, err instanceof Error ? err.message : String(err));
        }
      }
      new GoogleAIFileManager(apiKey).deleteFile(fileInfo.name).catch(() => {});
    }

    // Fallback: inline base64 com múltiplos MIMEs
    console.log("[media-transcribe] File API falhou — tentando inline base64");
    const base64 = mediaBuffer.toString("base64");
    const audioMimes = [rawMimeType, mimeType, "audio/ogg", "audio/webm", "audio/mp4"]
      .filter((m, i, arr) => Boolean(m) && arr.indexOf(m) === i);

    for (const aMime of audioMimes) {
      for (const modelId of modelsToTry.slice(0, 3)) {
        try {
          const model = genAI.getGenerativeModel({ model: modelId });
          const result = await model.generateContent([
            { inlineData: { mimeType: aMime, data: base64 } },
            { text: prompts.audio },
          ]);
          const text = result.response.text().trim();
          if (text) {
            console.log(`[media-transcribe] inline ${aMime} + ${modelId} → "${text.slice(0, 120)}"`);
            return text;
          }
        } catch (err) {
          console.error(`[media-transcribe] inline ${aMime} + ${modelId} falhou:`, err instanceof Error ? err.message : String(err));
        }
      }
    }
    return null;
  }

  // ── Vídeo / Documento: File API primeiro, inline como fallback ────────────
  if (kind === "video" || kind === "document") {
    console.log(`[media-transcribe] ${kind}: usando File API (${mediaBuffer.length} bytes, mime=${mimeType})`);

    const fileInfo = await uploadAudioToFileAPI(mediaBuffer, mimeType, apiKey);

    if (fileInfo) {
      const fileManager = new GoogleAIFileManager(apiKey);
      for (const modelId of modelsToTry) {
        try {
          const model = genAI.getGenerativeModel({ model: modelId });
          const result = await model.generateContent([
            { fileData: { mimeType, fileUri: fileInfo.uri } },
            { text: prompts[kind] },
          ]);
          const text = result.response.text().trim();
          if (text) {
            console.log(`[media-transcribe] File API + ${modelId} (${kind}) → "${text.slice(0, 120)}"`);
            fileManager.deleteFile(fileInfo.name).catch(() => {});
            return text;
          }
        } catch (err) {
          console.error(`[media-transcribe] File API + ${modelId} (${kind}) falhou:`, err instanceof Error ? err.message : String(err));
        }
      }
      new GoogleAIFileManager(apiKey).deleteFile(fileInfo.name).catch(() => {});
    }

    // Fallback: inline base64
    console.log(`[media-transcribe] File API falhou para ${kind} — tentando inline base64`);
  }

  // ── Imagem (e fallback para vídeo/doc): inline base64 ─────────────────────
  const base64 = mediaBuffer.toString("base64");
  for (const modelId of modelsToTry) {
    try {
      const model = genAI.getGenerativeModel({ model: modelId });
      const result = await model.generateContent([
        { inlineData: { mimeType, data: base64 } },
        { text: prompts[kind] },
      ]);
      const text = result.response.text().trim();
      if (text) {
        console.log(`[media-transcribe] inline ${modelId} (${kind}) → "${text.slice(0, 120)}"`);
        return text;
      }
    } catch (err) {
      console.error(`[media-transcribe] inline ${modelId} (${kind}) falhou:`, err instanceof Error ? err.message : String(err));
    }
  }
  return null;
}
