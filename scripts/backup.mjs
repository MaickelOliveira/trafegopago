import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readFile, rm, stat, writeFile, open } from "node:fs/promises";
import { createCipheriv, createHash, randomBytes } from "node:crypto";
import { pipeline } from "node:stream/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import pg from "pg";
import { google } from "googleapis";

// OAuth credentials can be supplied by the server environment or the manager's
// dedicated Drive consent. The encryption key always stays outside the database.
if (!process.argv.includes("--local-only") && !process.env.BACKUP_GOOGLE_REFRESH_TOKEN && process.env.DATABASE_URL) {
  const settingsClient = new pg.Client({ connectionString: process.env.DATABASE_URL });
  try {
    await settingsClient.connect();
    const settings = (await settingsClient.query("SELECT payload FROM app_documents WHERE name='config.json'")).rows[0]?.payload;
    if (settings) for (const [envKey, configKey] of Object.entries({ BACKUP_GOOGLE_CLIENT_ID: "backupGoogleClientId", BACKUP_GOOGLE_CLIENT_SECRET: "backupGoogleClientSecret", BACKUP_GOOGLE_REFRESH_TOKEN: "backupGoogleRefreshToken", BACKUP_DRIVE_FOLDER_ID: "backupDriveFolderId" })) process.env[envKey] = settings[configKey] || "";
  } finally { await settingsClient.end(); }
}
const required = ["DATABASE_URL", "BACKUP_ENCRYPTION_KEY"];
const localOnly = process.argv.includes("--local-only");
if (!localOnly) required.push("BACKUP_DRIVE_FOLDER_ID", "BACKUP_GOOGLE_CLIENT_ID", "BACKUP_GOOGLE_CLIENT_SECRET", "BACKUP_GOOGLE_REFRESH_TOKEN");
for (const name of required) if (!process.env[name]) throw new Error(`Configure ${name}.`);
const key = Buffer.from(process.env.BACKUP_ENCRYPTION_KEY, "base64");
if (key.length !== 32) throw new Error("A chave do backup deve conter 32 bytes em base64.");
const directory = path.resolve(process.env.BACKUP_DIR || "private/backups");
await mkdir(directory, { recursive: true, mode: 0o700 });
const day = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const name = `trafegopago-${day}-${Date.now()}.dump.enc`;
const output = path.join(directory, name);
const dump = `${output}.partial`;
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
let lockHeld = false;
try {
  await client.connect();
  lockHeld = (await client.query("SELECT pg_try_advisory_lock(721461, 2) AS locked")).rows[0].locked;
  if (!lockHeld) { console.log("Outro backup está em andamento."); process.exitCode = 0; }
  else {
    const previous = await client.query("SELECT status FROM backup_runs WHERE day=$1", [day]);
    if (previous.rows[0]?.status === "completed" && !process.argv.includes("--force")) console.log("Backup diário já concluído.");
    else {
      await client.query("INSERT INTO backup_runs(day,status) VALUES($1,'running') ON CONFLICT(day) DO UPDATE SET status='running',started_at=now(),completed_at=NULL,error_code=NULL", [day]);
      // The connection string stays in the child environment, never in process arguments.
      const url = new URL(process.env.DATABASE_URL);
      const env = { ...process.env, PGDATABASE: decodeURIComponent(url.pathname.slice(1)), PGHOST: url.searchParams.get("host") || url.hostname, PGPORT: url.port || "5432", PGUSER: decodeURIComponent(url.username), PGPASSWORD: decodeURIComponent(url.password), PGSSLMODE: url.searchParams.get("sslmode") || process.env.PGSSLMODE || "prefer" };
      const child = spawn(process.env.PG_DUMP_BIN || "pg_dump", ["--format=custom", "--no-owner", "--no-acl", `--file=${dump}`], { env, stdio: ["ignore", "ignore", "pipe"] });
      let stderr = "";
      child.stderr.on("data", chunk => { stderr = (stderr + chunk.toString()).slice(-1000); });
      await new Promise((resolve, reject) => { child.on("error", reject); child.on("exit", code => code === 0 ? resolve() : reject(new Error("pg_dump_failed"))); });
      if ((await stat(dump)).size < 64) throw new Error("empty_dump");
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", key, iv);
      const destination = createWriteStream(output, { mode: 0o600 });
      destination.write(Buffer.concat([Buffer.from("TPBK1"), iv]));
      await pipeline(createReadStream(dump), cipher, destination);
      const file = await open(output, "a");
      try { await file.write(cipher.getAuthTag()); } finally { await file.close(); }
      const hash = createHash("sha256");
      for await (const chunk of createReadStream(output)) hash.update(chunk);
      const sha256 = hash.digest("hex");
      let driveFileId = null;
      if (!localOnly) {
        const oauth = new google.auth.OAuth2(process.env.BACKUP_GOOGLE_CLIENT_ID, process.env.BACKUP_GOOGLE_CLIENT_SECRET);
        oauth.setCredentials({ refresh_token: process.env.BACKUP_GOOGLE_REFRESH_TOKEN });
        const drive = google.drive({ version: "v3", auth: oauth });
        const folder = await drive.files.get({ fileId: process.env.BACKUP_DRIVE_FOLDER_ID, fields: "id,mimeType,trashed" });
        const permissions = await drive.permissions.list({ fileId: process.env.BACKUP_DRIVE_FOLDER_ID, fields: "permissions(type,role)", pageSize: 100 });
        if (folder.data.trashed || folder.data.mimeType !== "application/vnd.google-apps.folder" || !permissions.data.permissions?.length || permissions.data.permissions.some(permission => permission.type !== "user" || permission.role !== "owner")) throw Error("backup_folder_not_private");
        const result = await drive.files.create({ requestBody: { name, parents: [process.env.BACKUP_DRIVE_FOLDER_ID], appProperties: { app: "trafegopago-backup", sha256 } }, media: { mimeType: "application/octet-stream", body: createReadStream(output) }, fields: "id,size,md5Checksum", supportsAllDrives: true });
        driveFileId = result.data.id;
        if (!driveFileId || Number(result.data.size) !== (await stat(output)).size) throw new Error("drive_verification_failed");
      }
      await writeFile(`${output}.json`, JSON.stringify({ name, day, sha256, driveFileId, encrypted: true }), { mode: 0o600 });
      await client.query("UPDATE backup_runs SET status=$2,completed_at=now(),drive_file_id=$3,sha256=$4 WHERE day=$1", [day, localOnly ? "failed" : "completed", driveFileId, sha256]);
      console.log(JSON.stringify({ encrypted: true, localOnly, driveUploaded: !!driveFileId, sha256, file: output }));
    }
  }
} catch {
  if (lockHeld) await client.query("UPDATE backup_runs SET status='failed',error_code='backup_failed' WHERE day=$1", [day]).catch(() => {});
  console.error("O backup não foi concluído. Verifique as configurações e tente novamente.");
  process.exitCode = 1;
} finally {
  await rm(dump, { force: true });
  if (lockHeld) await client.query("SELECT pg_advisory_unlock(721461, 2)").catch(() => {});
  await client.end();
}
