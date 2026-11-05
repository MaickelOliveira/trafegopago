import { NextRequest, NextResponse } from "next/server";
import { drive as createDrive } from "googleapis/build/src/apis/drive/index.js";
import { createNexoGoogleOAuthClient, nexoGoogleCredentials } from "./google-nexo-auth";
import { consumeOAuthState } from "./oauth-state";
import { getConfig, saveConfig } from "./clients";
import { withDataTransaction } from "./document-store";
class BackupFolderAccessError extends Error {}
export async function completeDriveBackupAuthorization(request: NextRequest): Promise<NextResponse> {
  const config = await getConfig();
  const base = (process.env.APP_BASE_URL || config.appBaseUrl || request.nextUrl.origin).replace(/\/$/, "");
  try {
    await consumeOAuthState("google-backup", request.nextUrl.searchParams.get("state"));
    const code = request.nextUrl.searchParams.get("code"); if (!code) throw Error("Consent not completed");
    const credentials = nexoGoogleCredentials(config);
    if (!credentials) throw Error("Nexo Google application not configured");
    const oauth = createNexoGoogleOAuthClient(config, base, "backup");
    const { tokens } = await oauth.getToken(code);
    if (!tokens.refresh_token || !tokens.scope?.split(" ").includes("https://www.googleapis.com/auth/drive.file")) throw Error("Drive permission was not granted");
    oauth.setCredentials(tokens);
    const drive = createDrive({ version: "v3", auth: oauth });
    let folderId = config.backupDriveFolderId;
    if (folderId) {
      try {
        const existing = await drive.files.get({ fileId: folderId, fields: "id,mimeType,trashed" });
        if (existing.data.trashed || existing.data.mimeType !== "application/vnd.google-apps.folder") throw new BackupFolderAccessError();
      } catch { throw new BackupFolderAccessError(); }
    }
    if (!folderId) {
      const folder = await drive.files.create({ requestBody: { name: "Backups — Plataforma Tráfego Pago", mimeType: "application/vnd.google-apps.folder", appProperties: { purpose: "trafegopago-backup" } }, fields: "id" });
      folderId = folder.data.id || undefined;
    }
    if (!folderId) throw Error("Backup folder not created");
    const permissions = await drive.permissions.list({ fileId: folderId, fields: "permissions(id,type,role)" });
    if (!permissions.data.permissions?.length || permissions.data.permissions.some(permission => permission.type !== "user" || permission.role !== "owner")) throw Error("Backup folder must remain private");
    await withDataTransaction(async () => {
      const current = await getConfig();
      if (current.backupDriveFolderId && current.backupDriveFolderId !== folderId) throw new BackupFolderAccessError();
      await saveConfig({ ...current, backupDriveFolderId: folderId, backupGoogleRefreshToken: tokens.refresh_token!, backupGoogleClientId: credentials.clientId, backupGoogleClientSecret: credentials.clientSecret });
    });
    return NextResponse.redirect(`${base}/gestor/configuracoes?backup=connected`);
  } catch (error) {
    return NextResponse.redirect(`${base}/gestor/configuracoes?backup=${error instanceof BackupFolderAccessError ? "folder_access" : "error"}`);
  }
}
