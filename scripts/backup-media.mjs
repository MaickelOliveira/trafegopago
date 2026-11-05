import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import pg from "pg";
import { google } from "googleapis";
import { createEncryptedMediaArchive, scanMediaFiles, filesNeedingBackup } from "./lib/encrypted-media-archive.mjs";
import { uploadDriveResumable } from "./lib/drive-resumable-upload.mjs";

if (!process.env.DATABASE_URL || !process.env.BACKUP_ENCRYPTION_KEY) throw Error("Backup de mídia sem configuração.");
if (!process.env.BACKUP_GOOGLE_REFRESH_TOKEN) {
  const settingsClient = new pg.Client({ connectionString: process.env.DATABASE_URL });
  try {
    await settingsClient.connect();
    const settings = (await settingsClient.query("SELECT payload FROM app_documents WHERE name='config.json'")).rows[0]?.payload;
    if (settings) for (const [envKey, configKey] of Object.entries({ BACKUP_GOOGLE_CLIENT_ID: "backupGoogleClientId", BACKUP_GOOGLE_CLIENT_SECRET: "backupGoogleClientSecret", BACKUP_GOOGLE_REFRESH_TOKEN: "backupGoogleRefreshToken", BACKUP_DRIVE_FOLDER_ID: "backupDriveFolderId" })) process.env[envKey] = settings[configKey] || "";
  } finally { await settingsClient.end(); }
}
for (const name of ["BACKUP_GOOGLE_CLIENT_ID", "BACKUP_GOOGLE_CLIENT_SECRET", "BACKUP_GOOGLE_REFRESH_TOKEN", "BACKUP_DRIVE_FOLDER_ID"]) if (!process.env[name]) throw Error("Backup de mídia sem autorização do Drive.");
const key = Buffer.from(process.env.BACKUP_ENCRYPTION_KEY, "base64");
if (key.length !== 32) throw Error("Chave de backup inválida.");
const dataDirectory = path.resolve(process.env.DATA_DIR || path.join(process.cwd(), "data"));
const backupDirectory = path.resolve(process.env.BACKUP_DIR || "private/backups");
await mkdir(backupDirectory, { recursive: true, mode: 0o700 });
const day = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const name = `trafegopago-media-${day}-${Date.now()}.tar.gz.enc`;
const output = path.join(backupDirectory, name);
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
let locked = false;
try {
  await client.connect();
  locked = (await client.query("SELECT pg_try_advisory_lock(721461, 3) AS locked")).rows[0].locked;
  if (!locked) { console.log("Outra cópia de mídia está em andamento."); process.exitCode = 0; }
  else {
    const previous = await client.query("SELECT status FROM media_backup_runs WHERE day=$1", [day]);
    if (previous.rows[0]?.status === "completed") console.log("Cópia diária de mídia já concluída.");
    else {
      await client.query("INSERT INTO media_backup_runs(day,status) VALUES($1,'running') ON CONFLICT(day) DO UPDATE SET status='running',started_at=now(),completed_at=NULL,error_code=NULL", [day]);
      const scanned = await scanMediaFiles(dataDirectory);
      const backedUp = await client.query("SELECT relative_path,bytes,mtime_ms FROM media_backup_files");
      const selected = filesNeedingBackup(scanned, backedUp.rows);
      const priorArchive = await client.query("SELECT 1 FROM media_backup_runs WHERE status='completed' AND drive_file_id IS NOT NULL LIMIT 1");
      const archiveKind = priorArchive.rowCount && backedUp.rows.length ? "incremental" : "full";
      if (!selected.length) {
        await client.query("UPDATE media_backup_runs SET status='completed',completed_at=now(),drive_file_id=NULL,sha256=NULL,file_count=0,source_bytes=0,archive_kind='no_changes' WHERE day=$1", [day]);
        console.log(JSON.stringify({ encrypted: true, driveUploaded: false, noChanges: true, fileCount: 0 }));
      } else {
      const { sha256, fileCount, sourceBytes, encryptedBytes } = await createEncryptedMediaArchive({ dataDirectory, output, key, selectedPaths: selected.map(file => file.relativePath) });
      const oauth = new google.auth.OAuth2(process.env.BACKUP_GOOGLE_CLIENT_ID, process.env.BACKUP_GOOGLE_CLIENT_SECRET);
      oauth.setCredentials({ refresh_token: process.env.BACKUP_GOOGLE_REFRESH_TOKEN });
      const drive = google.drive({ version: "v3", auth: oauth });
      const folder = await drive.files.get({ fileId: process.env.BACKUP_DRIVE_FOLDER_ID, fields: "id,mimeType,trashed" });
      const permissions = await drive.permissions.list({ fileId: process.env.BACKUP_DRIVE_FOLDER_ID, fields: "permissions(type,role)", pageSize: 100 });
      if (folder.data.trashed || folder.data.mimeType !== "application/vnd.google-apps.folder" || !permissions.data.permissions?.length || permissions.data.permissions.some(permission => permission.type !== "user" || permission.role !== "owner")) throw Error("Pasta de backup não é privada.");
      const accessToken = (await oauth.getAccessToken()).token;
      const uploaded = await uploadDriveResumable({ accessToken, filePath: output, folderId: process.env.BACKUP_DRIVE_FOLDER_ID, name, sha256 });
      if (!uploaded.id || Number(uploaded.size) !== encryptedBytes) throw Error("Envio de mídia não conferido.");
      await writeFile(`${output}.json`, JSON.stringify({ name, day, sha256, driveFileId: uploaded.id, fileCount, sourceBytes, encrypted: true }), { mode: 0o600 });
      await client.query("BEGIN");
      try {
        await client.query("UPDATE media_backup_runs SET status='completed',completed_at=now(),drive_file_id=$2,sha256=$3,file_count=$4,source_bytes=$5,archive_kind=$6 WHERE day=$1", [day, uploaded.id, sha256, fileCount, sourceBytes, archiveKind]);
        for (let i = 0; i < selected.length; i += 250) {
          const batch = selected.slice(i, i + 250);
          const values = batch.map((_, index) => `($${index * 4 + 1},$${index * 4 + 2},$${index * 4 + 3},$${index * 4 + 4})`).join(",");
          await client.query(`INSERT INTO media_backup_files(relative_path,bytes,mtime_ms,backed_up_day) VALUES ${values} ON CONFLICT(relative_path) DO UPDATE SET bytes=excluded.bytes,mtime_ms=excluded.mtime_ms,backed_up_day=excluded.backed_up_day`, batch.flatMap(file => [file.relativePath, file.bytes, file.mtimeMs, day]));
        }
        await client.query("COMMIT");
      } catch (error) { await client.query("ROLLBACK"); throw error; }
      await rm(output, { force: true });
      console.log(JSON.stringify({ encrypted: true, driveUploaded: true, sha256, archiveKind, fileCount, sourceBytes }));
      }
    }
  }
} catch {
  if (locked) await client.query("UPDATE media_backup_runs SET status='failed',error_code='media_backup_failed' WHERE day=$1", [day]).catch(() => {});
  await rm(output, { force: true }).catch(() => {});
  console.error("A cópia de mídia não foi concluída. Confira a configuração e tente novamente.");
  process.exitCode = 1;
} finally {
  if (locked) await client.query("SELECT pg_advisory_unlock(721461, 3)").catch(() => {});
  await client.end().catch(() => {});
}
