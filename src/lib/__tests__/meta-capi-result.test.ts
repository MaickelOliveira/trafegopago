import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../clients", () => ({ getConfig: async () => ({ metaToken: "" }) }));
import { sendCapiEvent } from "../meta-capi";

const base = { pixelId: "123", capiToken: "token", eventName: "Lead", phone: "44999999999" };
afterEach(() => vi.unstubAllGlobals());

describe("sendCapiEvent result", () => {
  it("reports acceptance, test mode and which matching keys were sent", async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ events_received: 1 }), { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    const result = await sendCapiEvent({ ...base, testEventCode: " TEST1 ", clientIp: "203.0.113.9", fbp: "fb.1.1.1", fbclid: "abc", fbclickTimeMs: 1 });
    expect(result).toBe("Lead aceito pela Meta [teste TEST1] com ip, fbp, fbc");
    const body = JSON.parse((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body.test_event_code).toBe("TEST1");
    expect(body.data[0].user_data.fbc).toBe("fb.1.1.abc");
  });
  it("shows the purchase value in the result", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ events_received: 1 }), { status: 200 })));
    const result = await sendCapiEvent({ ...base, eventName: "Purchase", value: 125000, currency: "BRL" });
    expect(result).toContain("Purchase aceito pela Meta — valor BRL 125.000,00");
  });

  it("sends city, state and every external id in hash", async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ events_received: 1 }), { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    const visitor = "a".repeat(64);
    await sendCapiEvent({ ...base, externalId: "lead-1", extraExternalIds: [visitor, "not-a-hash"], city: "campomourao", state: "pr" });
    const user = JSON.parse((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body as string).data[0].user_data;
    expect(user.external_id).toHaveLength(2);
    expect(user.external_id).toContain(visitor);
    expect(user.ct).toMatch(/^[a-f0-9]{64}$/);
    expect(user.st).toMatch(/^[a-f0-9]{64}$/);
  });
  it("reports Meta errors and missing credentials instead of failing silently", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: { message: "Invalid token" } }), { status: 400 })));
    expect(await sendCapiEvent(base)).toBe("recusado pela Meta (HTTP 400): Invalid token");
    expect(await sendCapiEvent({ ...base, capiToken: undefined })).toMatch(/^não enviado: faltando token/);
  });
});
