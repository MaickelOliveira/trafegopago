import { open, stat } from "node:fs/promises";

const ENDPOINT = "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id%2Csize";
const DEFAULT_CHUNK_BYTES = 8 * 1024 * 1024;

function sessionUrl(location) {
  const url = new URL(location);
  if (url.protocol !== "https:" || url.hostname !== "www.googleapis.com" || !url.pathname.startsWith("/upload/drive/v3/files")) throw Error("Sessão de upload inválida.");
  return url.toString();
}

function nextOffset(response, size) {
  const range = response.headers.get("range");
  const match = /^bytes=0-(\d+)$/.exec(range || "");
  if (!range) return 0;
  if (!match || Number(match[1]) >= size) throw Error("Posição do upload inválida.");
  return Number(match[1]) + 1;
}

/** Uploads the encrypted file in resumable chunks; only the session URI is used. */
export async function uploadDriveResumable({ accessToken, filePath, folderId, name, sha256, fetchImpl = fetch, chunkBytes = DEFAULT_CHUNK_BYTES }) {
  if (!accessToken || !folderId || !name || !/^[a-f0-9]{64}$/.test(sha256) || chunkBytes <= 0 || chunkBytes % (256 * 1024) !== 0) throw Error("Parâmetros de upload inválidos.");
  const size = (await stat(filePath)).size;
  if (!size) throw Error("Arquivo vazio.");
  const headers = { Authorization: `Bearer ${accessToken}` };
  const initiated = await fetchImpl(ENDPOINT, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json; charset=UTF-8", "X-Upload-Content-Type": "application/octet-stream", "X-Upload-Content-Length": String(size) },
    body: JSON.stringify({ name, parents: [folderId], appProperties: { app: "trafegopago-media-backup", sha256 } }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!initiated.ok) throw Error(`Não foi possível iniciar o envio (${initiated.status}).`);
  const location = initiated.headers.get("location");
  if (!location) throw Error("Google não devolveu a sessão de envio.");
  const url = sessionUrl(location);
  const file = await open(filePath, "r");
  try {
    let offset = 0, failures = 0;
    while (offset < size) {
      const length = Math.min(chunkBytes, size - offset);
      const bytes = Buffer.allocUnsafe(length);
      const read = await file.read(bytes, 0, length, offset);
      if (read.bytesRead !== length) throw Error("Arquivo mudou durante o envio.");
      let response;
      try {
        response = await fetchImpl(url, { method: "PUT", headers: { ...headers, "Content-Type": "application/octet-stream", "Content-Length": String(length), "Content-Range": `bytes ${offset}-${offset + length - 1}/${size}` }, body: bytes, signal: AbortSignal.timeout(120_000) });
      } catch { /* Ask the session which bytes reached Drive. */ }
      if (response?.status === 200 || response?.status === 201) return await response.json();
      if (response?.status === 308) { offset = nextOffset(response, size); failures = 0; continue; }
      if (response && response.status < 500 && response.status !== 429) throw Error(`Envio recusado (${response.status}).`);
      if (++failures > 5) throw Error("Envio interrompido repetidamente.");
      const status = await fetchImpl(url, { method: "PUT", headers: { ...headers, "Content-Range": `bytes */${size}`, "Content-Length": "0" }, signal: AbortSignal.timeout(30_000) });
      if (status.status === 200 || status.status === 201) return await status.json();
      if (status.status !== 308) throw Error(`Sessão de envio indisponível (${status.status}).`);
      offset = nextOffset(status, size);
    }
    throw Error("Envio não finalizado pelo Google.");
  } finally { await file.close(); }
}
