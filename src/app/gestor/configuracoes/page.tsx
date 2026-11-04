import { isDailyBackupConfigured } from "@/lib/backup-status";
import { getConfig } from "@/lib/clients";
import { databasePool } from "@/lib/document-store";
import { PlatformSettingsView } from "@/components/gestor/PlatformSettingsView";
export default async function PlatformSettingsPage({ searchParams }: { searchParams: Promise<{ backup?: string; googleAds?: string }> }) {
  const { backup: backupResult, googleAds: googleAdsResult } = await searchParams;
  const config = await getConfig();
  const backup = await databasePool().query("SELECT completed_at FROM backup_runs WHERE status='completed' ORDER BY day DESC LIMIT 1");
  return <PlatformSettingsView googleAdsResult={googleAdsResult} backupResult={backupResult} meta={!!config.metaToken} google={!!config.googleAdsRefreshToken} whatsapp={!!(config.evolutionServer || process.env.EVOLUTION_SERVER)} ai={!!(config.geminiApiKey || config.anthropicApiKey || process.env.GEMINI_API_KEY)} driveConfigured={isDailyBackupConfigured(config)} latestBackup={backup.rows[0]?.completed_at?.toISOString() ?? null} driveFolderUrl={(config.backupDriveFolderId || process.env.BACKUP_DRIVE_FOLDER_ID) ? `https://drive.google.com/drive/folders/${encodeURIComponent(config.backupDriveFolderId || process.env.BACKUP_DRIVE_FOLDER_ID!)}` : null} />;
}
