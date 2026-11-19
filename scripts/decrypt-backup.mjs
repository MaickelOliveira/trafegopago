import { open, stat, rm } from "node:fs/promises";
import { createReadStream, createWriteStream } from "node:fs";
import { createDecipheriv } from "node:crypto";
import { pipeline } from "node:stream/promises";

const [source, destination] = process.argv.slice(2);
if (!source || !destination) throw new Error("Informe arquivo criptografado e destino NOVO.");
const key = Buffer.from(process.env.BACKUP_ENCRYPTION_KEY || "", "base64");
if (key.length !== 32) throw new Error("Chave de backup inválida.");
const size = (await stat(source)).size;
if (size < 34) throw new Error("Arquivo inválido.");
const input = await open(source, "r");
const header = Buffer.alloc(17), tag = Buffer.alloc(16);
try { await input.read(header, 0, 17, 0); await input.read(tag, 0, 16, size - 16); } finally { await input.close(); }
if (header.subarray(0, 5).toString() !== "TPBK1") throw new Error("Formato de backup inválido.");
const decipher = createDecipheriv("aes-256-gcm", key, header.subarray(5));
decipher.setAuthTag(tag);
let created = false;
const output = createWriteStream(destination, { flags: "wx", mode: 0o600 });
output.once("open", () => { created = true; });
try { await pipeline(createReadStream(source, { start: 17, end: size - 17 }), decipher, output); }
catch (error) { if (created) await rm(destination, { force: true }); throw error; }
console.log("Backup descriptografado. Restaure somente em banco separado para conferência.");
