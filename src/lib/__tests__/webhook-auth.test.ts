import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { authorizeWhatsAppWebhook, signWebhookUrl, verifyMetaSignature } from "../webhook-auth";
afterEach(() => vi.unstubAllEnvs());
describe("provider webhook authentication", () => {
  it("binds a signed webhook to its exact connection path", () => {
    vi.stubEnv("JWT_SECRET", "test-secret-only");
    const url = signWebhookUrl("https://example.com/api/whatsapp/webhook/evolution/a");
    expect(authorizeWhatsAppWebhook(new NextRequest(url))).toBe(true);
    expect(authorizeWhatsAppWebhook(new NextRequest(url.replace("/a?", "/b?")))).toBe(false);
    expect(authorizeWhatsAppWebhook(new NextRequest("https://example.com/api/whatsapp/webhook/evolution/a"))).toBe(false);
  });
  it("validates the Meta raw payload and rejects tampering or missing credentials", () => {
    const raw = '{"entry":[]}'; const signature = `sha256=${createHmac("sha256", "secret").update(raw).digest("hex")}`;
    expect(verifyMetaSignature(raw, signature, "secret")).toBe(true);
    expect(verifyMetaSignature(raw + " ", signature, "secret")).toBe(false);
    expect(verifyMetaSignature(raw, signature, undefined)).toBe(false);
    expect(verifyMetaSignature(raw, null, "secret")).toBe(false);
  });
});
