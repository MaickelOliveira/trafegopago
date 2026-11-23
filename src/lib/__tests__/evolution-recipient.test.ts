import { describe, expect, it } from "vitest";
import { evolutionRecipientKeys, evolutionRecipientNumber } from "../evolution-recipient";

const normalize = (phone: string) => `normalized:${phone}`;

describe("Evolution recipient after reconnection", () => {
  it("adds the country code to a local JID without changing its digits", () => {
    expect(evolutionRecipientNumber("44900000000", false, true, normalize)).toBe("5544900000000");
    expect(evolutionRecipientNumber("1112345678", false, true, normalize)).toBe("1112345678");
  });

  it("preserves complete phone numbers, LIDs, and groups", () => {
    expect(evolutionRecipientNumber("551112345678", false, true, normalize)).toBe("551112345678");
    expect(evolutionRecipientNumber("5544900000000", false, true, normalize)).toBe("5544900000000");
    expect(evolutionRecipientNumber("123456789012345@lid", true, true, normalize)).toBe("123456789012345@lid");
    expect(evolutionRecipientNumber("120363000000@g.us", false, true, normalize)).toBe("120363000000@g.us");
  });

  it("keeps the existing normalization path for manually entered numbers", () => {
    expect(evolutionRecipientNumber("1112345678", false, false, normalize)).toBe("normalized:1112345678");
  });

  it("recognizes an echoed response under either form of the same recipient", () => {
    expect(evolutionRecipientKeys("11123456789", "5511123456789")).toEqual(["11123456789", "5511123456789"]);
    expect(evolutionRecipientKeys("5511123456789", "5511123456789")).toEqual(["5511123456789"]);
  });
});
