/**
 * Faz download e descriptografia de mídia do WhatsApp (AES-256-CBC + HKDF),
 * depois transcreve/descreve via Gemini.
 *
 * Para áudio usa a Gemini File API (upload + fileData) — mais confiável
 * para OGG/Opus do que inlineData base64.
 * Para imagem/vídeo/documento usa inlineData base64.
 */
import { createDecipheriv, hkdfSync } from "crypto";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import path from "path";
import { GoogleGenerativeAI } from "@google/generative-ai";

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
      signal: AbortSignal.timeout(20_000),
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
    // Log primeiros bytes para validar formato (OGG = 4f676753 "OggS", JPEG = ffd8ff)
    console.log(`[media-decrypt] Descriptografado: ${decrypted.length} bytes, magic=${decrypted.subarray(0, 4).toString("hex")}`);
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
 * Faz upload do buffer para a Gemini File API via upload resumível.
 * Retorna { uri, name } ou null em caso de erro.
 */
async function uploadToGeminiFileAPI(
  buffer: Buffer,
  mimeType: string,
  apiKey: string,
): Promise<{ uri: string; name: string } | null> {
  try {
    // 1. Inicia upload resumível
    const initRes = await fetch(
      `https://generativelanguage.googleapis.com/upload/v1beta/files?key=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        headers: {
          "X-Goog-Upload-Protocol": "resumable",
          "X-Goog-Upload-Command": "start",
          "X-Goog-Upload-Header-Content-Length": buffer.length.toString(),
          "X-Goog-Upload-Header-Content-Type": mimeType,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ file: { displayName: `audio-${Date.now()}` } }),
        signal: AbortSignal.timeout(10_000),
      }
    );
    console.log(`[gemini-file-api] init status=${initRes.status}`);

    const uploadUrl = initRes.headers.get("x-goog-upload-url");
    if (!uploadUrl) {
      const body = await initRes.text().catch(() => "");
      console.error("[gemini-file-api] Sem upload URL. Body:", body.slice(0, 300));
      return null;
    }

    // 2. Envia o buffer
    const uploadRes = await fetch(uploadUrl, {
      method: "PUT",
      headers: {
        "Content-Length": buffer.length.toString(),
        "X-Goog-Upload-Offset": "0",
        "X-Goog-Upload-Command": "upload, finalize",
      },
      body: new Uint8Array(buffer),
      signal: AbortSignal.timeout(20_000),
    });

    if (!uploadRes.ok) {
      const errBody = await uploadRes.text().catch(() => "");
      console.error(`[gemini-file-api] Upload falhou ${uploadRes.status}: ${errBody.slice(0, 200)}`);
      return null;
    }

    const fileData = await uploadRes.json() as Record<string, Record<string, unknown>>;
    const file = fileData.file;
    if (!file?.uri) {
      console.error("[gemini-file-api] Sem URI na resposta:", JSON.stringify(fileData).slice(0, 300));
      return null;
    }

    // 3. Aguarda processamento (tipicamente imediato para arquivos pequenos)
    let fileState = String(file.state ?? "ACTIVE");
    const fileName = String(file.name ?? "");
    let retries = 0;
    while (fileState === "PROCESSING" && retries < 15) {
      await new Promise<void>((r) => setTimeout(r, 2000));
      try {
        const statusRes = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/${fileName}?key=${encodeURIComponent(apiKey)}`,
          { signal: AbortSignal.timeout(5_000) }
        );
        const statusData = await statusRes.json() as Record<string, unknown>;
        fileState = String(statusData.state ?? "");
      } catch { /* retenta */ }
      retries++;
    }

    if (fileState === "FAILED") {
      console.error("[gemini-file-api] Processamento falhou após", retries, "tentativas");
      return null;
    }

    console.log(`[gemini-file-api] Arquivo pronto: uri=${String(file.uri).slice(0, 80)} state=${fileState}`);
    return { uri: String(file.uri), name: fileName };
  } catch (err) {
    console.error("[gemini-file-api] Erro no upload:", err instanceof Error ? err.message : String(err));
    return null;
  }
}

function deleteGeminiFile(fileName: string, apiKey: string): void {
  if (!fileName) return;
  fetch(
    `https://generativelanguage.googleapis.com/v1beta/${fileName}?key=${encodeURIComponent(apiKey)}`,
    { method: "DELETE" }
  ).catch(() => {});
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
    "gemini-2.5-pro-preview-05-06",
    "gemini-2.5-pro",
    "gemini-2.5-flash-preview-05-20",
    "gemini-2.5-flash",
    "gemini-2.0-flash",
    "gemini-1.5-flash",
  ];

  // ── Áudio: File API (upload + fileData) — Google recomenda para OGG/Opus ──
  if (kind === "audio") {
    console.log(`[media-transcribe] Áudio: tentando File API (${mediaBuffer.length} bytes, mime=${mimeType})`);

    const fileInfo = await uploadToGeminiFileAPI(mediaBuffer, mimeType, apiKey);

    if (fileInfo) {
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
            deleteGeminiFile(fileInfo.name, apiKey);
            return text;
          }
        } catch (err) {
          console.error(`[media-transcribe] File API + ${modelId} falhou:`, err instanceof Error ? err.message : String(err));
        }
      }
      deleteGeminiFile(fileInfo.name, apiKey);
    }

    // Fallback: inline base64 com múltiplos MIMEs (OGG nativo, Vorbis, WebM)
    console.log("[media-transcribe] File API falhou — tentando inline base64");
    const base64 = mediaBuffer.toString("base64");
    const audioMimes = [rawMimeType, mimeType, "audio/ogg", "audio/webm", "audio/mp4"]
      .filter((m, i, arr) => m && arr.indexOf(m) === i);

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

  // ── Imagem / Vídeo / Documento: inline base64 ──────────────────────────────
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
        console.log(`[media-transcribe] ${modelId} → "${text.slice(0, 120)}"`);
        return text;
      }
    } catch (err) {
      console.error(`[media-transcribe] ${modelId} falhou:`, err instanceof Error ? err.message : String(err));
    }
  }
  return null;
}
