// Restore the encrypted pre-migration JSON snapshot into a new private directory.
import { readFile, mkdir, readdir, writeFile, stat } from "node:fs/promises";
import { privateDecrypt, createDecipheriv, constants } from "node:crypto";
import { gunzipSync } from "node:zlib";
import path from "node:path";
const [source, privateKeyPath, destination] = process.argv.slice(2);
if (!source || !privateKeyPath || !destination) throw Error("Informe backup, chave privada local e pasta nova de conferência.");
const directory = path.resolve(destination);
try { await stat(directory); throw Error("A pasta de destino já existe. Escolha uma pasta nova."); } catch (error) { if (error.code !== "ENOENT") throw error; }
const envelope = JSON.parse(await readFile(source, "utf8"));
if (envelope.format !== "TPJSON1") throw Error("Formato de backup inválido.");
const key = privateDecrypt({ key: await readFile(privateKeyPath), oaepHash: "sha256", padding: constants.RSA_PKCS1_OAEP_PADDING }, Buffer.from(envelope.wrappedKey, "base64"));
const cipher = createDecipheriv("aes-256-gcm", key, Buffer.from(envelope.iv, "base64"));
cipher.setAAD(Buffer.from("trafegopago-json-snapshot-v1")); cipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
const snapshot = JSON.parse(gunzipSync(Buffer.concat([cipher.update(Buffer.from(envelope.ciphertext, "base64")), cipher.final()])));
if (snapshot.format !== "legacy-json-snapshot-v1" || !snapshot.files || Object.keys(snapshot.files).some(name => !/^[a-z0-9][a-z0-9._-]*\.json$/i.test(name))) throw Error("Conteúdo de backup inválido.");
await mkdir(directory, { mode: 0o700 });
for (const [name, payload] of Object.entries(snapshot.files)) await writeFile(path.join(directory, name), JSON.stringify(payload), { mode: 0o600, flag: "wx" });
console.log(JSON.stringify({ restored: true, files: Object.keys(snapshot.files).length, createdAt: snapshot.createdAt, privateDirectory: directory }));
