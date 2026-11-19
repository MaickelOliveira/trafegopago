import type { AppConfig } from "./clients";
export function isDailyBackupConfigured(config?: Partial<AppConfig>): boolean {
  const credentials = process.env.BACKUP_GOOGLE_REFRESH_TOKEN
    ? [process.env.BACKUP_GOOGLE_CLIENT_ID, process.env.BACKUP_GOOGLE_CLIENT_SECRET, process.env.BACKUP_GOOGLE_REFRESH_TOKEN, process.env.BACKUP_DRIVE_FOLDER_ID]
    : [config?.backupGoogleClientId, config?.backupGoogleClientSecret, config?.backupGoogleRefreshToken, config?.backupDriveFolderId];
  return credentials.every(Boolean) && Buffer.from(process.env.BACKUP_ENCRYPTION_KEY || "", "base64").length === 32;
}
