import { describe, expect, it } from "vitest";
import { isMetaAccessToken } from "../client-settings";

describe("isMetaAccessToken", () => {
  it("accepts a Conversions API token", () => {
    expect(isMetaAccessToken(" EAAB" + "x".repeat(150) + " ")).toBe(true);
  });
  it("rejects a password autofilled by the browser", () => {
    expect(isMetaAccessToken("MinhaSenha@2026")).toBe(false);
    expect(isMetaAccessToken("EAA short")).toBe(false);
  });
});
