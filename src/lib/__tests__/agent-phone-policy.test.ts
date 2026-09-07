import { describe, expect, it } from "vitest";
import {
  isAgentPhoneIgnored,
  isValidAgentPhone,
  normalizeAgentPhone,
  sanitizeAgentPhoneList,
  splitAgentPhoneInput,
} from "../agent-phone-policy";

describe("agent phone silence policy", () => {
  it("normalizes, validates and deduplicates configured numbers", () => {
    expect(normalizeAgentPhone("+55 (44) 99999-9999")).toBe("5544999999999");
    expect(normalizeAgentPhone("0057 300 123 4567")).toBe("573001234567");
    expect(isValidAgentPhone("+52 55 1234 5678")).toBe(true);
    expect(isValidAgentPhone("123")).toBe(false);
    expect(sanitizeAgentPhoneList(["+55 44 99999-9999", "5544999999999", "123"]))
      .toEqual(["5544999999999"]);
  });

  it("accepts one number per line, comma or semicolon", () => {
    expect(splitAgentPhoneInput("5511999999999\n573001234567, 525512345678;56912345678"))
      .toEqual(["5511999999999", "573001234567", "525512345678", "56912345678"]);
  });

  it("silences exact international numbers without blocking similar contacts", () => {
    const cfg = { ignoredPhones: ["573001234567", "525512345678"] };
    expect(isAgentPhoneIgnored(cfg, "+57 300 123 4567")).toBe(true);
    expect(isAgentPhoneIgnored(cfg, "525512345678")).toBe(true);
    expect(isAgentPhoneIgnored(cfg, "573001234568")).toBe(false);
  });

  it("handles Brazilian country-code and ninth-digit variations", () => {
    const cfg = { ignoredPhones: ["5544999999999"] };
    expect(isAgentPhoneIgnored(cfg, "44999999999")).toBe(true);
    expect(isAgentPhoneIgnored(cfg, "554499999999")).toBe(true);
  });

  it("can compare the real phone when the provider sends a LID identifier", () => {
    const cfg = { ignoredPhones: ["5511999999999"] };
    expect(isAgentPhoneIgnored(cfg, "252291043082372", "5511999999999")).toBe(true);
  });
});
