import { afterEach, expect, it, vi } from "vitest";
import type { AppConfig } from "../clients";
const fixtures = vi.hoisted(() => ({ config: {} as AppConfig }));
vi.mock("../clients", () => ({ getConfig: async () => fixtures.config }));
import { createNexoGoogleOAuthClient, hasNexoGoogleAdsAuthorization, nexoGoogleCredentials } from "../google-nexo-auth";
import { getOAuth2Client } from "../google-calendar";
import { getGoogleAdsCreds } from "../google-ads-creds";
import { mergePlatformConfig, platformConfigPatch, safePlatformConfig } from "../platform-settings";

const config = (): AppConfig => ({
  manager: { email: "manager@example.invalid", passwordHash: "synthetic-hash" }, metaToken: "synthetic-meta",
  googleClientId: "legacy.apps.googleusercontent.com", googleClientSecret: "synthetic-legacy",
  nexoGoogleClientId: "nexo.apps.googleusercontent.com", nexoGoogleClientSecret: "synthetic-nexo",
  googleAdsDeveloperToken: "synthetic-developer", googleAdsRefreshToken: "synthetic-refresh", googleAdsOAuthClientId: "nexo.apps.googleusercontent.com",
  backupGoogleClientId: "backup.apps.googleusercontent.com", backupGoogleClientSecret: "synthetic-backup-secret", backupGoogleRefreshToken: "synthetic-backup-refresh", backupDriveFolderId: "synthetic-private-folder",
});
afterEach(() => vi.unstubAllEnvs());
it("never substitutes legacy configuration or environment credentials for a missing Nexo application", () => {
  vi.stubEnv("GOOGLE_CLIENT_ID", "legacy-env.apps.googleusercontent.com"); vi.stubEnv("GOOGLE_CLIENT_SECRET", "synthetic-env");
  const existing = { ...config(), nexoGoogleClientId: undefined, nexoGoogleClientSecret: undefined };
  expect(nexoGoogleCredentials(existing)).toBeNull();
  expect(() => createNexoGoogleOAuthClient(existing, "https://platform.example.invalid", "ads")).toThrow();
  expect(hasNexoGoogleAdsAuthorization(existing)).toBe(false);
});
it("refuses incomplete Nexo pairs without borrowing a legacy key", () => {
  expect(() => nexoGoogleCredentials({ ...config(), nexoGoogleClientSecret: undefined })).toThrow();
  expect(() => nexoGoogleCredentials({ ...config(), nexoGoogleClientId: undefined })).toThrow();
});
it("uses the independent Nexo application for both callback paths", () => {
  for (const purpose of ["ads", "backup"] as const) {
    const url = new URL(createNexoGoogleOAuthClient(config(), "https://platform.example.invalid/", purpose).generateAuthUrl({ scope: purpose === "ads" ? "https://www.googleapis.com/auth/adwords" : "https://www.googleapis.com/auth/drive.file" }));
    expect(url.searchParams.get("client_id")).toBe(config().nexoGoogleClientId);
    expect(url.searchParams.get("redirect_uri")).toBe(`https://platform.example.invalid/api/agent/${purpose === "ads" ? "google-ads-auth" : "google-auth"}/callback`);
    expect(url.searchParams.get("scope")).not.toContain("calendar");
  }
});
it("preserves the legacy application for existing calendar and spreadsheet connections", async () => {
  fixtures.config = config();
  vi.stubEnv("GOOGLE_CLIENT_ID", "legacy-env.apps.googleusercontent.com"); vi.stubEnv("GOOGLE_CLIENT_SECRET", "synthetic-env");
  const url = new URL((await getOAuth2Client("https://platform.example.invalid")).generateAuthUrl({ scope: "https://www.googleapis.com/auth/calendar" }));
  expect(url.searchParams.get("client_id")).toBe("legacy-env.apps.googleusercontent.com");
  expect(fixtures.config.googleClientSecret).toBe("synthetic-legacy");
});
it("uses only a refresh token bound to the selected Nexo application", async () => {
  fixtures.config = config();
  expect((await getGoogleAdsCreds())?.clientId).toBe(fixtures.config.nexoGoogleClientId);
  fixtures.config.googleAdsOAuthClientId = "legacy.apps.googleusercontent.com";
  expect(await getGoogleAdsCreds()).toBeNull();
  fixtures.config.googleAdsOAuthClientId = undefined;
  expect(await getGoogleAdsCreds()).toBeNull();
});
it("requires a new Ads authorization after rotating the Nexo pair while preserving calendar and backup credentials", () => {
  const current = config();
  const updated = mergePlatformConfig(current, platformConfigPatch({ nexoGoogleClientId: "new-nexo.apps.googleusercontent.com", nexoGoogleClientSecret: "synthetic-new" }));
  expect(updated.googleAdsRefreshToken).toBeUndefined(); expect(updated.googleAdsOAuthClientId).toBeUndefined();
  for (const key of ["googleClientId", "googleClientSecret", "backupGoogleClientId", "backupGoogleClientSecret", "backupGoogleRefreshToken", "backupDriveFolderId", "metaToken"] as const) expect(updated[key]).toBe(current[key]);
  expect(current.googleAdsRefreshToken).toBe("synthetic-refresh");
});
it("preserves a matching authorization when saving unchanged or unrelated settings", () => {
  const current = config();
  const updated = mergePlatformConfig(current, platformConfigPatch({ nexoGoogleClientId: current.nexoGoogleClientId, nexoGoogleClientSecret: "", masterPhone: "5500000000000" }));
  expect(updated.googleAdsRefreshToken).toBe(current.googleAdsRefreshToken);
  expect(updated.nexoGoogleClientSecret).toBe(current.nexoGoogleClientSecret);
  expect(() => mergePlatformConfig(current, { nexoGoogleClientId: "" })).toThrow();
});
it("rejects an incomplete initial pair atomically", () => {
  const current = { ...config(), nexoGoogleClientId: undefined, nexoGoogleClientSecret: undefined };
  expect(() => mergePlatformConfig(current, { nexoGoogleClientId: "nexo.apps.googleusercontent.com" })).toThrow();
  expect(current.googleAdsRefreshToken).toBe("synthetic-refresh");
});
it("masks Nexo keys and all authorization tokens in settings responses", () => {
  const safe = safePlatformConfig(config());
  expect(safe.nexoGoogleClientSecret).toBe(""); expect(safe.configuredSecrets.nexoGoogleClientSecret).toBe(true);
  expect(safe.googleAdsConnected).toBe(true);
  const body = JSON.stringify(safe);
  for (const value of ["synthetic-nexo", "synthetic-refresh", "synthetic-backup-secret", "synthetic-backup-refresh", "synthetic-legacy"]) expect(body).not.toContain(value);
  expect(platformConfigPatch({ googleAdsOAuthClientId: "injected", googleAdsRefreshToken: "injected", backupGoogleRefreshToken: "injected" })).toEqual({});
});
