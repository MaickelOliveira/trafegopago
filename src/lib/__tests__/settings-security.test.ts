import { describe, expect, it } from "vitest";
import { parseClientSettings, publicClientSettings } from "../client-settings";
import { platformConfigPatch, safePlatformConfig } from "../platform-settings";
import type { Client, AppConfig } from "../clients";
describe("settings boundaries", () => {
  it("does not accept stored hashes, ownership or an agent configuration from a basic client form", () => {
    const { patch } = parseClientSettings({ name: "Empresa", id: "another", passwordHash: "injected", agentConfigs: [{ enabled: true }], email: "Test@EXAMPLE.COM" });
    expect(patch).toEqual({ name: "Empresa", email: "test@example.com" });
  });
  it("rejects weak and bcrypt-truncated passwords", () => {
    expect(() => parseClientSettings({ password: "short" })).toThrow();
    expect(() => parseClientSettings({ password: "á".repeat(40) })).toThrow();
  });
  it("preserves a blank credential and rejects nonfinite costs and unknown systems", () => {
    expect(parseClientSettings({ capiToken: "", password: "", cplTarget: 0 }).patch).toEqual({ cplTarget: 0 });
    expect(() => parseClientSettings({ cplTarget: NaN })).toThrow();
    expect(() => parseClientSettings({ enabledSystems: ["unexpected"] })).toThrow();
  });
  it("returns a configured indicator without transmitting secrets", () => {
    const client = { id: "a", name: "A", capiToken: "private", passwordHash: "hash", agentConfig: { geminiApiKey: "secret" } } as Client;
    const safe = publicClientSettings(client);
    expect(safe.hasCapiToken).toBe(true); expect(JSON.stringify(safe)).not.toContain("private"); expect(safe).not.toHaveProperty("agentConfig");
    const config = safePlatformConfig({ metaToken: "token", googleClientSecret: "secret", manager: { passwordHash: "hash" } } as AppConfig);
    expect(config.configuredSecrets.metaToken).toBe(true); expect(config.metaToken).toBe(""); expect(config).not.toHaveProperty("manager");
  });
  it("preserves empty keys and refuses unapproved settings and unsafe URL schemes", () => {
    expect(platformConfigPatch({ geminiApiKey: "", googleAdsRefreshToken: "injected", manager: {} })).toEqual({});
    expect(() => platformConfigPatch({ evolutionServer: "file:///etc/passwd" })).toThrow();
    expect(() => platformConfigPatch({ appBaseUrl: {} })).toThrow();
  });
});
