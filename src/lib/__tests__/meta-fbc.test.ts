import { describe, expect, it } from "vitest";
import { parseFbc } from "../meta-fbc";

describe("parseFbc", () => {
  const now = Date.now();
  it("reads the click time and fbclid of a site fbc", () => {
    expect(parseFbc(`fb.1.${now}.IwAR0abcDEF_123-x`)).toEqual({ fbclid: "IwAR0abcDEF_123-x", clickTimeMs: now });
  });
  it("keeps the new Meta suffix so the rebuilt fbc is identical", () => {
    const value = `fb.1.${now}.IwAR0abc.AQ`;
    const parsed = parseFbc(value)!;
    expect(`fb.1.${parsed.clickTimeMs}.${parsed.fbclid}`).toBe(value);
  });
  it("rejects malformed, stale or non-string values", () => {
    expect(parseFbc("")).toBeNull();
    expect(parseFbc("fb.1.123.abc")).toBeNull();
    expect(parseFbc(`fb.1.${now - 91 * 86_400_000}.IwAR0abc`)).toBeNull();
    expect(parseFbc({})).toBeNull();
  });
});
