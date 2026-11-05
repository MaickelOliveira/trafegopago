import { afterEach, describe, expect, it, vi } from "vitest";
import { ownsAdAccount, metaObjectBelongsToAccount } from "../ad-account-access";
afterEach(() => vi.unstubAllGlobals());
describe("advertising account isolation", () => {
  it("keeps the platform and account identity together", () => {
    const accounts = [{id:"act_123",platform:"meta"},{id:"456",platform:"google"}];
    expect(ownsAdAccount(accounts,"meta","123")).toBe(true);
    expect(ownsAdAccount(accounts,"google","123")).toBe(false);
    expect(ownsAdAccount(accounts,"meta","999")).toBe(false);
    expect(ownsAdAccount(accounts,"meta","123?fields=token")).toBe(false);
  });
  it("rejects a foreign campaign even when the path includes an owned account", async () => {
    vi.stubGlobal("fetch",vi.fn().mockResolvedValue(new Response(JSON.stringify({account_id:"999"}))));
    expect(await metaObjectBelongsToAccount("44","act_123","test-token")).toBe(false);
  });
  it("recognizes the same Google account with or without separators", () => {
    const accounts = [{id:"123-456-7890",platform:"google"}];
    expect(ownsAdAccount(accounts,"google","1234567890")).toBe(true);
    expect(ownsAdAccount(accounts,"google","123-456-7890")).toBe(true);
    expect(ownsAdAccount(accounts,"google","999-888-7776")).toBe(false);
    expect(ownsAdAccount(accounts,"google","act_1234567890")).toBe(false);
    expect(ownsAdAccount(accounts,"google","123--456-7890")).toBe(false);
  });
  it("fails closed when ownership cannot be confirmed", async () => {
    vi.stubGlobal("fetch",vi.fn().mockRejectedValue(new Error("timeout")));
    expect(await metaObjectBelongsToAccount("44","act_123","test-token")).toBe(false);
  });
});
