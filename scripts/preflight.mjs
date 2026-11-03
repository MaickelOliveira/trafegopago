import pg from "pg";
const issues = [];
for (const key of ["DATABASE_URL", "JWT_SECRET", "BACKUP_ENCRYPTION_KEY"]) if (!process.env[key]) issues.push(`missing:${key}`);
if (process.env.BACKUP_ENCRYPTION_KEY && Buffer.from(process.env.BACKUP_ENCRYPTION_KEY, "base64").length !== 32) issues.push("invalid:BACKUP_ENCRYPTION_KEY");
if (process.env.JWT_SECRET && process.env.JWT_SECRET.length < 32) issues.push("weak:JWT_SECRET");
if (!process.env.APP_BASE_URL || !process.env.APP_BASE_URL.startsWith("https://")) issues.push("invalid:APP_BASE_URL");
if (process.env.DATABASE_URL) {
 const client = new pg.Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 10000 });
 try {
  await client.connect();
  const tables = await client.query("SELECT to_regclass('public.app_documents') AS docs,to_regclass('public.app_records') AS records,to_regclass('public.backup_runs') AS backups,to_regclass('public.auth_rate_limits') AS limits");
  if (Object.values(tables.rows[0]).some(value => !value)) issues.push("missing:database-migrations");
  else {
   const docs = (await client.query("SELECT name,payload FROM app_documents WHERE name=ANY($1)", [["clients.json","config.json","funnels.json"]])).rows;
   for (const name of ["clients.json","config.json","funnels.json"]) if (!docs.some(row => row.name === name)) issues.push(`missing:import:${name}`);
   const config = docs.find(row => row.name === "config.json")?.payload;
   const drive = process.env.BACKUP_GOOGLE_REFRESH_TOKEN
     ? [process.env.BACKUP_DRIVE_FOLDER_ID,process.env.BACKUP_GOOGLE_CLIENT_ID,process.env.BACKUP_GOOGLE_CLIENT_SECRET,process.env.BACKUP_GOOGLE_REFRESH_TOKEN]
     : [config?.backupDriveFolderId,config?.backupGoogleClientId,config?.backupGoogleClientSecret,config?.backupGoogleRefreshToken];
   if (!drive.every(Boolean)) issues.push("missing:drive-backup-consent");
   const normalized = await client.query("SELECT count(*)::integer AS count FROM app_records");
   const originals = await client.query("SELECT 1 FROM app_documents WHERE name IN ('leads.json','conversations.json','pending-responses.json','followups.json') AND payload NOT IN ('[]'::jsonb,'{}'::jsonb) LIMIT 1");
   if (originals.rowCount && !normalized.rows[0].count) issues.push("missing:normalized-record-import");
   const funnels = docs.find(row => row.name === "funnels.json")?.payload || [];
   if (funnels.some(funnel => funnel.connections?.some(connection => connection.type === "meta")) && !config?.metaAppSecret && !process.env.META_APP_SECRET) issues.push("missing:meta-app-signature-secret");
   const completed = await client.query("SELECT 1 FROM backup_runs WHERE status='completed' AND drive_file_id IS NOT NULL LIMIT 1");
   if (!completed.rowCount) issues.push("unverified:drive-backup");
  }
 } catch { issues.push("unavailable:database"); } finally { await client.end().catch(() => {}); }
}
console.log(JSON.stringify({ readyForCutover: issues.length === 0, issues, activeServiceChanged: false }, null, 2));
if (issues.length) process.exitCode = 1;
