import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { formatGoogleAdsError } from "../google-ads-api";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({
  consume: vi.fn(), exchange: vi.fn(), save: vi.fn(),
  config: { appBaseUrl: "https://platform.example.invalid", metaToken: "synthetic-existing-meta", googleAdsRefreshToken: "synthetic-old" },
}));
vi.mock("@/lib/oauth-state", () => ({ consumeOAuthState: mocks.consume }));
vi.mock("@/lib/google-ads-auth", () => ({ exchangeAdsCode: mocks.exchange }));
vi.mock("@/lib/clients", () => ({ getConfig: async () => ({ ...mocks.config }), saveConfig: mocks.save }));
vi.mock("@/lib/document-store", () => ({ withDataTransaction: async (operation: () => Promise<void>) => operation() }));
import { GET } from "@/app/api/agent/google-ads-auth/callback/route";
beforeEach(() => { vi.clearAllMocks(); mocks.consume.mockResolvedValue({}); mocks.exchange.mockResolvedValue("synthetic-new"); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });
const request = () => new NextRequest("https://platform.example.invalid/api/agent/google-ads-auth/callback?state=synthetic-state&code=synthetic-code");
it("rejects expired authorization without exchanging or replacing credentials", async () => {
  mocks.consume.mockRejectedValueOnce(Error("expired"));
  const response = await GET(request());
  expect(response.headers.get("location")).toBe("https://platform.example.invalid/gestor/configuracoes?googleAds=expired");
  expect(mocks.exchange).not.toHaveBeenCalled(); expect(mocks.save).not.toHaveBeenCalled();
});
it("preserves the latest configuration when saving a renewed Ads authorization", async () => {
  mocks.exchange.mockImplementationOnce(async () => { mocks.config.metaToken = "synthetic-concurrent-meta-change"; return "synthetic-new"; });
  const response = await GET(request());
  expect(response.headers.get("location")).toContain("googleAds=connected");
  expect(mocks.save).toHaveBeenCalledWith({ ...mocks.config, googleAdsRefreshToken: "synthetic-new" });
});
it("keeps the prior credential and excludes provider payloads from failure logs", async () => {
  mocks.exchange.mockRejectedValueOnce({ request: { client_secret: "synthetic-must-not-be-logged" } });
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  const response = await GET(request());
  expect(response.headers.get("location")).toContain("googleAds=error");
  expect(mocks.save).not.toHaveBeenCalled(); expect(JSON.stringify(log.mock.calls)).not.toContain("synthetic-must-not-be-logged");
});

it("does not expose an unknown transport error containing credentials", () => {
  expect(formatGoogleAdsError({ request: { client_secret: "synthetic-private" }, headers: { authorization: "synthetic-private" } })).toBe("Não foi possível consultar o Google Ads.");
  expect(formatGoogleAdsError({ error: "invalid_grant", request: { client_secret: "synthetic-private" } })).toBe("invalid_grant");
  expect(formatGoogleAdsError({ errors: [{ message: "Account permission denied" }] })).toBe("Account permission denied");
});

it("uses the configured public address instead of a forwarded host", async () => {
  vi.stubEnv("APP_BASE_URL", "https://configured.example.invalid");
  const response = await GET(new NextRequest("https://internal.example.invalid/api/agent/google-ads-auth/callback?state=synthetic&code=synthetic", { headers: { "x-forwarded-host": "attacker.example.invalid" } }));
  expect(response.headers.get("location")).toBe("https://configured.example.invalid/gestor/configuracoes?googleAds=connected");
});
