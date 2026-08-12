import { describe, it, expect, vi, afterEach } from "vitest";
import { checkRateLimit } from "../rate-limit";

afterEach(() => {
  vi.useRealTimers();
});

describe("checkRateLimit", () => {
  it("permite até o limite de tentativas dentro da janela", () => {
    const key = `test-${Math.random()}`;
    for (let i = 0; i < 5; i++) {
      expect(checkRateLimit(key, 5, 60_000)).toBe(true);
    }
  });

  it("bloqueia a partir da tentativa que excede o limite", () => {
    const key = `test-${Math.random()}`;
    for (let i = 0; i < 5; i++) checkRateLimit(key, 5, 60_000);
    expect(checkRateLimit(key, 5, 60_000)).toBe(false);
  });

  it("chaves diferentes têm contadores independentes", () => {
    const keyA = `a-${Math.random()}`;
    const keyB = `b-${Math.random()}`;
    for (let i = 0; i < 5; i++) checkRateLimit(keyA, 5, 60_000);
    expect(checkRateLimit(keyA, 5, 60_000)).toBe(false);
    expect(checkRateLimit(keyB, 5, 60_000)).toBe(true);
  });

  it("libera de novo depois que a janela expira", () => {
    vi.useFakeTimers();
    const key = `test-${Math.random()}`;
    for (let i = 0; i < 5; i++) checkRateLimit(key, 5, 60_000);
    expect(checkRateLimit(key, 5, 60_000)).toBe(false);

    vi.advanceTimersByTime(61_000);
    expect(checkRateLimit(key, 5, 60_000)).toBe(true);
  });
});
