import { describe, expect, it } from "vitest";
import { isPublicAddress, postPublicWebhook } from "../public-webhook";
describe("webhook network boundaries", () => {
  it.each(["127.0.0.1", "10.0.0.4", "172.16.2.2", "192.168.1.1", "169.254.169.254", "100.64.0.1", "::1", "::ffff:127.0.0.1", "fe80::1", "fc00::1", "2001:db8::1"])("rejects private or reserved address %s", address => {
    expect(isPublicAddress(address)).toBe(false);
  });
  it("permits public IPv4 and IPv6 unicast", () => {
    expect(isPublicAddress("8.8.8.8")).toBe(true);
    expect(isPublicAddress("2606:4700:4700::1111")).toBe(true);
  });
  it("rejects credentials and non-HTTPS destinations before connecting", async () => {
    await expect(postPublicWebhook("http://127.0.0.1", "{}")).rejects.toThrow();
    await expect(postPublicWebhook("https://name:password@example.com", "{}")).rejects.toThrow();
  });
});
