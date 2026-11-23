import { describe, expect, it } from "vitest";
import { chatDayKey, chatDayLabel, chatTime, groupChatMessages } from "../chat-dates";

describe("conversation calendar", () => {
  it("keeps messages on the Brazilian day across UTC midnight", () => {
    const now = Date.parse("2026-11-04T01:00:00Z");
    expect(chatDayKey(now)).toBe("2026-11-03");
    expect(chatTime(now)).toBe("22:00");
    expect(chatDayLabel(now, now)).toBe("Hoje · 03/11/2026");
  });
  it("labels yesterday across an end of year", () => {
    expect(chatDayLabel(Date.parse("2025-12-31T20:00:00Z"), Date.parse("2026-01-01T15:00:00Z"))).toBe("Ontem · 31/12/2025");
  });
  it("does not combine the same day and month in different years", () => {
    const messages = [{ts:Date.parse("2025-11-03T14:00:00Z"),content:"old"},{ts:Date.parse("2026-11-03T14:00:00Z"),content:"new"}];
    const result = groupChatMessages(messages, Date.parse("2026-11-05T15:00:00Z"));
    expect(result.map(group=>group.label)).toEqual(["03/11/2025","03/11/2026"]);
    expect(result.flatMap(group=>group.messages)).toEqual(messages);
  });
  it("puts the midnight change at 03:00 UTC and preserves messages", () => {
    const messages = [{ts:Date.parse("2026-11-04T02:59:00Z")},{ts:Date.parse("2026-11-04T03:00:00Z")}];
    expect(groupChatMessages(messages).map(group=>group.key)).toEqual(["2026-11-03","2026-11-04"]);
    expect(chatDayLabel(NaN)).toBe("Data não informada");
    expect(chatTime(NaN)).toBe("—");
  });
});
