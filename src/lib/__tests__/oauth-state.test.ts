import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { decodeJwt } from "jose";
const state = vi.hoisted(() => ({ jar: new Map<string, string>(), session: { sub: "manager", role: "manager" } as { sub: string; role: string } }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: (key: string) => state.jar.has(key) ? { value: state.jar.get(key) } : undefined, set: (key: string, value: string) => state.jar.set(key, value), delete: (key: string) => state.jar.delete(key) }) }));
vi.mock("../auth", () => ({ getSession: async () => state.session }));
import { createOAuthState, consumeOAuthState } from "../oauth-state";
beforeEach(() => { vi.stubEnv("JWT_SECRET", "test-only-oauth-secret-32-characters"); state.jar.clear(); state.session = { sub: "manager", role: "manager" }; });
afterEach(() => vi.unstubAllEnvs());
describe("OAuth callback state", () => {
 it("binds a callback to the initiating session and consumes it once", async () => { const token = await createOAuthState("google-calendar", { clientId: "a", connId: "x" }); expect(await consumeOAuthState("google-calendar", token)).toEqual({ clientId: "a", connId: "x" }); await expect(consumeOAuthState("google-calendar", token)).rejects.toThrow(); });
 it("rejects another provider, even with a browser nonce", async () => { const token = await createOAuthState("google-calendar"); await createOAuthState("google-backup"); await expect(consumeOAuthState("google-backup", token)).rejects.toThrow(); });
 it("rejects a changed signature, a missing nonce and another manager session", async () => { const token = await createOAuthState("meta"); await expect(consumeOAuthState("meta", token.slice(0, -3) + "xxx")).rejects.toThrow(); await expect(consumeOAuthState("meta", token)).rejects.toThrow(); const second = await createOAuthState("meta"); state.session.sub = "different-manager"; await expect(consumeOAuthState("meta", second)).rejects.toThrow(); });
 it("does not initiate a manager-only authorization as an employee", async () => { state.session.role = "employee"; await expect(createOAuthState("google-backup")).rejects.toThrow(); });
 it("allows thirty minutes for the manual Google conversion consent and keeps other flows short", async () => {
  const conversions=decodeJwt(await createOAuthState("google-conversions",{clientId:"vitalli-garden"}));
  const ads=decodeJwt(await createOAuthState("google-ads"));
  expect((conversions.exp ?? 0)-(conversions.iat ?? 0)).toBe(1800);
  expect((ads.exp ?? 0)-(ads.iat ?? 0)).toBe(600);
 });
});
