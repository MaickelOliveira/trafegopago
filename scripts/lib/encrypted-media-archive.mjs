import { createReadStream, createWriteStream } from "node:fs";
import { lstat, open, readdir, rm, stat, writeFile } from "node:fs/promises";
import { createCipheriv, createHash, randomBytes } from "node:crypto";
import { pipeline } from "node:stream/promises";
import { spawn } from "node:child_process";
import path from "node:path";

/** A streaming, authenticated archive of chat media and uploaded files only. */
export async function scanMediaFiles(dataDirectory) {
  const sourceDirectories = [];
  const files = [];
  for (const directoryName of ["media", "uploads"]) {
    const sourceDirectory = path.join(dataDirectory, directoryName);
    const directoryInfo = await lstat(sourceDirectory).catch(error => { if (error.code === "ENOENT") return null; throw error; });
    if (!directoryInfo) continue;
    if (!directoryInfo.isDirectory() || directoryInfo.isSymbolicLink()) throw Error("Pasta de mídia inválida.");
    sourceDirectories.push(directoryName);
    for (const item of await readdir(sourceDirectory)) {
      if (!/^[A-Za-z0-9._-]+$/.test(item) || item === "." || item === "..") throw Error("Nome inesperado na pasta de mídia.");
      const info = await lstat(path.join(sourceDirectory, item));
      if (!info.isFile() || info.isSymbolicLink()) throw Error("Entrada inesperada na pasta de mídia.");
      files.push({ relativePath: `${directoryName}/${item}`, bytes: info.size, mtimeMs: Math.round(info.mtimeMs) });
    }
  }
  if (!sourceDirectories.length) throw Error("Pastas de mídia ausentes.");
  return files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

export function filesNeedingBackup(scanned, backedUpRows) {
  const previous = new Map(backedUpRows.map(row => [row.relative_path, row]));
  return scanned.filter(file => {
    const earlier = previous.get(file.relativePath);
    return !earlier || Number(earlier.bytes) !== file.bytes || Number(earlier.mtime_ms) !== file.mtimeMs;
  });
}

export async function createEncryptedMediaArchive({ dataDirectory, output, key, selectedPaths }) {
  if (!Buffer.isBuffer(key) || key.length !== 32) throw Error("Chave de backup inválida.");
  const scanned = await scanMediaFiles(dataDirectory);
  const selected = selectedPaths ? scanned.filter(file => selectedPaths.includes(file.relativePath)) : scanned;
  if (!selected.length || selectedPaths && selected.length !== new Set(selectedPaths).size) throw Error("Nenhum arquivo de mídia válido para esta cópia.");
  const fileCount = selected.length;
  const sourceBytes = selected.reduce((sum, file) => sum + file.bytes, 0);
  const listPath = `${output}.files`;
  await writeFile(listPath, selected.map(file => file.relativePath).join("\n") + "\n", { mode: 0o600, flag: "wx" });
  try {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const destination = createWriteStream(output, { flags: "wx", mode: 0o600 });
  destination.write(Buffer.concat([Buffer.from("TPBK1"), iv]));
  const tar = spawn("tar", ["-czf", "-", "-C", dataDirectory, "-T", listPath], { stdio: ["ignore", "pipe", "pipe"] });
  tar.stderr.resume();
  const tarExit = new Promise((resolve, reject) => { tar.once("error", reject); tar.once("exit", code => code === 0 ? resolve() : reject(Error("Falha ao criar arquivo de mídia."))); });
  await Promise.all([pipeline(tar.stdout, cipher, destination), tarExit]);
  const handle = await open(output, "a");
  try { await handle.write(cipher.getAuthTag()); } finally { await handle.close(); }
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(output)) hash.update(chunk);
  return { sha256: hash.digest("hex"), fileCount, sourceBytes, encryptedBytes: (await stat(output)).size };
  } finally { await rm(listPath, { force: true }); }
}
