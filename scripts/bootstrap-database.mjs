// Runs before the web server/workers. The legacy application must be fully
// drained/stopped before this first import; never run two writers on the volume.
import pg from "pg";
import { readFile, writeFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { createCipheriv, publicEncrypt, randomBytes, createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { spawn } from "node:child_process";
import path from "node:path";
const source = path.resolve(process.env.LEGACY_DATA_DIR || "data");
const archive = path.resolve(process.env.LEGACY_BACKUP_DIR || path.join(source,"audit-backups"));
async function run(script,args=[],env=process.env) {
  const child=spawn(process.execPath,[script,...args],{env,stdio:"inherit"});
  await new Promise((resolve,reject)=>{child.once("error",reject);child.once("exit",code=>code===0?resolve():reject(Error("Preparação do banco recusada.")));});
}
await run("scripts/migrate.mjs");
const client=new pg.Client({connectionString:process.env.DATABASE_URL});
let directory;
try {
 await client.connect();
 const existing=await client.query("SELECT 1 FROM app_documents UNION ALL SELECT 1 FROM app_records LIMIT 1");
 if (!existing.rowCount) {
  if (process.env.LEGACY_IMPORT_OLD_WRITER_STOPPED !== "true") throw Error("A importação inicial exige o encerramento completo do gravador antigo.");
  const names=JSON.parse(await readFile("db/legacy-collections.json","utf8")), files={}, raw=new Map();
  for (const name of names) {
   try { const content=await readFile(path.join(source,name),"utf8"); files[name]=JSON.parse(content);raw.set(name,content); }
   catch(error){if(error.code!=="ENOENT")throw error;}
  }
  for(const required of ["config.json","clients.json","funnels.json"])if(!raw.has(required))throw Error("A cópia de dados necessária não está disponível.");
  for(const[name,content]of raw)if(await readFile(path.join(source,name),"utf8")!==content)throw Error("Há outro processo gravando. A importação foi recusada.");
  if(!process.env.BACKUP_SNAPSHOT_PUBLIC_KEY)throw Error("Configure a chave pública de proteção da cópia inicial.");
  const key=randomBytes(32),iv=randomBytes(12),cipher=createCipheriv("aes-256-gcm",key,iv);
  cipher.setAAD(Buffer.from("trafegopago-json-snapshot-v1"));
  const createdAt=new Date().toISOString(),plaintext=gzipSync(Buffer.from(JSON.stringify({format:"legacy-json-snapshot-v1",createdAt,files})));
  const ciphertext=Buffer.concat([cipher.update(plaintext),cipher.final()]);
  const envelope={format:"TPJSON1",wrappedKey:publicEncrypt({key:Buffer.from(process.env.BACKUP_SNAPSHOT_PUBLIC_KEY,"base64"),format:"der",type:"spki",oaepHash:"sha256"},key).toString("base64"),iv:iv.toString("base64"),tag:cipher.getAuthTag().toString("base64"),ciphertext:ciphertext.toString("base64")};
  await mkdir(archive,{recursive:true,mode:0o700});
  const name=`antes-postgres-${Date.now()}.enc`,encrypted=Buffer.from(JSON.stringify(envelope));
  await writeFile(path.join(archive,name),encrypted,{flag:"wx",mode:0o600});
  await writeFile(path.join(archive,name+".json"),JSON.stringify({name,createdAt,sha256:createHash("sha256").update(encrypted).digest("hex"),collections:raw.size}),{flag:"wx",mode:0o600});
  directory=await mkdtemp(path.join(archive,".import-"));
  for(const[name,content]of raw)await writeFile(path.join(directory,name),content,{flag:"wx",mode:0o600});
  await run("scripts/import-json.mjs",["--frozen-snapshot"],{...process.env,SOURCE_DATA_DIR:directory});
  console.log(JSON.stringify({initialImport:true,encryptedSnapshot:true,collections:raw.size}));
 }
 if(process.env.LEGACY_CLIENT_ALIAS_FROM||process.env.LEGACY_CLIENT_ALIAS_TO) {
  if(!process.env.LEGACY_CLIENT_ALIAS_FROM||!process.env.LEGACY_CLIENT_ALIAS_TO)throw Error("Mapeamento histórico incompleto.");
  await run("scripts/repair-client-alias.mjs",["--from",process.env.LEGACY_CLIENT_ALIAS_FROM,"--to",process.env.LEGACY_CLIENT_ALIAS_TO,"--apply","--confirmed-same-client","--backup-verified"]);
 }
 await run("scripts/retire-whatsapp-providers.mjs",["--apply","--backup-verified"]);
 const required=await client.query("SELECT name FROM app_documents WHERE name=ANY($1)",[["config.json","clients.json","funnels.json"]]);
 if(required.rowCount!==3)throw Error("O banco não está pronto para receber a operação.");
 console.log("Banco conferido. A aplicação pode iniciar.");
} finally { await client.end();if(directory)await rm(directory,{recursive:true,force:true}); }
