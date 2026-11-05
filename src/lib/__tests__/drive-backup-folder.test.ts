import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({
  config: { appBaseUrl: "https://platform.example.invalid", backupDriveFolderId: "existing-private-folder", backupGoogleRefreshToken: "synthetic-old-backup", nexoGoogleClientId: "nexo.apps.googleusercontent.com", nexoGoogleClientSecret: "synthetic-nexo-key", googleAdsRefreshToken: "synthetic-ads", googleClientId: "legacy-calendar.apps.googleusercontent.com" },
  get: vi.fn(), create: vi.fn(), permissions: vi.fn(), token: vi.fn(), save: vi.fn(), consume: vi.fn(),
}));
vi.mock("@/lib/clients", () => ({ getConfig: async () => ({ ...mocks.config }), saveConfig: mocks.save }));
vi.mock("@/lib/document-store", () => ({ withDataTransaction: async (operation: () => Promise<void>) => operation() }));
vi.mock("@/lib/oauth-state", () => ({ consumeOAuthState: mocks.consume }));
vi.mock("@/lib/google-nexo-auth", async importOriginal => ({ ...await importOriginal<typeof import("@/lib/google-nexo-auth")>(), createNexoGoogleOAuthClient: () => ({ getToken: mocks.token, setCredentials: vi.fn() }) }));
vi.mock("googleapis/build/src/apis/drive/index.js", () => ({ drive: () => ({ files: { get: mocks.get, create: mocks.create }, permissions: { list: mocks.permissions } }) }));
import { completeDriveBackupAuthorization } from "../drive-backup-auth";

beforeEach(() => {
  vi.clearAllMocks(); mocks.config.backupDriveFolderId = "existing-private-folder";
  mocks.get.mockResolvedValue({ data: { id: "existing-private-folder", mimeType: "application/vnd.google-apps.folder", trashed: false } });
  mocks.create.mockResolvedValue({ data: { id: "first-private-folder" } });
  mocks.permissions.mockResolvedValue({ data: { permissions: [{ type: "user", role: "owner" }] } });
  mocks.token.mockResolvedValue({ tokens: { refresh_token: "synthetic-new-backup", scope: "https://www.googleapis.com/auth/drive.file" } });
});
const request = () => new NextRequest("https://platform.example.invalid/api/agent/google-auth/callback?state=synthetic&code=synthetic");
it("reuses the same private folder when renewing Drive authorization", async () => {
  const response = await completeDriveBackupAuthorization(request());
  expect(response.headers.get("location")).toContain("backup=connected");
  expect(mocks.create).not.toHaveBeenCalled();
  expect(mocks.save).toHaveBeenCalledWith({ ...mocks.config, backupGoogleRefreshToken: "synthetic-new-backup", backupGoogleClientId: mocks.config.nexoGoogleClientId, backupGoogleClientSecret: mocks.config.nexoGoogleClientSecret });
});
it("refuses to fork backups into another folder when access to the existing folder fails", async () => {
  mocks.get.mockRejectedValueOnce(Error("synthetic-permission-denied"));
  const response = await completeDriveBackupAuthorization(request());
  expect(response.headers.get("location")).toContain("backup=folder_access");
  expect(mocks.create).not.toHaveBeenCalled(); expect(mocks.save).not.toHaveBeenCalled();
  expect(mocks.config.backupGoogleRefreshToken).toBe("synthetic-old-backup");
});
it("does not replace a folder that is in the trash", async () => {
  mocks.get.mockResolvedValueOnce({ data: { mimeType: "application/vnd.google-apps.folder", trashed: true } });
  const response = await completeDriveBackupAuthorization(request());
  expect(response.headers.get("location")).toContain("backup=folder_access");
  expect(mocks.create).not.toHaveBeenCalled(); expect(mocks.save).not.toHaveBeenCalled();
});
it("creates a private folder only for the first connection", async () => {
  mocks.config.backupDriveFolderId = "";
  const response = await completeDriveBackupAuthorization(request());
  expect(response.headers.get("location")).toContain("backup=connected");
  expect(mocks.create).toHaveBeenCalledTimes(1);
  expect(mocks.save.mock.calls[0][0].backupDriveFolderId).toBe("first-private-folder");
});
it("keeps the prior configuration if the folder has additional sharing", async () => {
  mocks.permissions.mockResolvedValueOnce({ data: { permissions: [{ type: "user", role: "owner" }, { type: "anyone", role: "reader" }] } });
  const response = await completeDriveBackupAuthorization(request());
  expect(response.headers.get("location")).toContain("backup=error"); expect(mocks.save).not.toHaveBeenCalled();
});
it("preserves a folder committed concurrently by another completed authorization", async () => {
  mocks.config.backupDriveFolderId = "";
  mocks.permissions.mockImplementationOnce(async () => { mocks.config.backupDriveFolderId = "concurrent-private-folder"; return { data: { permissions: [{ type: "user", role: "owner" }] } }; });
  const response = await completeDriveBackupAuthorization(request());
  expect(response.headers.get("location")).toContain("backup=folder_access"); expect(mocks.save).not.toHaveBeenCalled();
});
