import { describe, it, expect } from "vitest";
// Plain ESM from the runner; `allowJs` lets TypeScript infer its types.
import { classifyModelError, isTransientNetworkError, createBackoff } from "../agent-runner/retry.mjs";

/** Minimal stand-in for a fetch Response. */
function res(status: number, body = "", headers: Record<string, string> = {}) {
  return {
    status,
    text: async () => body,
    headers: { get: (k: string) => headers[k.toLowerCase()] ?? null },
  };
}

const ctx = { model: "qwen/qwen3.8-27b", base: "https://api.groq.com/openai/v1" };

describe("model failure classification", () => {
  it("treats a rate limit as retryable", async () => {
    const err = await classifyModelError(res(429, "rate limit reached"), ctx);
    expect(err.retryable).toBe(true);
    expect(err.message).toMatch(/429/);
  });

  it("honours Retry-After instead of guessing", async () => {
    const err = await classifyModelError(res(429, "", { "retry-after": "42" }), ctx);
    expect(err.retryAfterMs).toBe(42_000);
    expect(err.message).toMatch(/42s/);
  });

  it("ignores a nonsense Retry-After", async () => {
    const err = await classifyModelError(res(429, "", { "retry-after": "soon" }), ctx);
    expect(err.retryAfterMs).toBeUndefined();
    expect(err.retryable).toBe(true);
  });

  it("caps an absurd Retry-After at ten minutes", async () => {
    const err = await classifyModelError(res(429, "", { "retry-after": "86400" }), ctx);
    expect(err.retryAfterMs).toBe(600_000);
  });

  it("treats provider 5xx as retryable", async () => {
    for (const s of [500, 502, 503]) {
      expect((await classifyModelError(res(s), ctx)).retryable, `HTTP ${s}`).toBe(true);
    }
  });

  it("never retries a retired model or a bad key", async () => {
    // These fail identically forever; retrying is an infinite loop.
    expect((await classifyModelError(res(404), ctx)).retryable).toBe(false);
    expect((await classifyModelError(res(401), ctx)).retryable).toBe(false);
    expect((await classifyModelError(res(403), ctx)).retryable).toBe(false);
    // A malformed request is our bug, not the provider's weather.
    expect((await classifyModelError(res(400, "bad json"), ctx)).retryable).toBe(false);
  });

  it("names the model on 404, since that is the usual cause", async () => {
    const err = await classifyModelError(res(404), ctx);
    expect(err.message).toContain("qwen/qwen3.8-27b");
    expect(err.message).toContain("/models");
  });
});

describe("transient network errors", () => {
  it("retries timeouts and dropped connections", () => {
    expect(isTransientNetworkError({ name: "TimeoutError" })).toBe(true);
    expect(isTransientNetworkError({ name: "AbortError" })).toBe(true);
    expect(isTransientNetworkError({ code: "ECONNRESET" })).toBe(true);
    expect(isTransientNetworkError({ cause: { code: "ETIMEDOUT" } })).toBe(true);
  });

  it("does not retry an ordinary bug", () => {
    expect(isTransientNetworkError(new TypeError("x is not a function"))).toBe(false);
    expect(isTransientNetworkError(null)).toBe(false);
  });

  it("lets an explicit classification win over the heuristics", () => {
    expect(isTransientNetworkError({ retryable: true })).toBe(true);
    // A 400 that happens to carry a network-ish code must still not retry.
    expect(isTransientNetworkError({ retryable: false, code: "ECONNRESET" })).toBe(false);
  });
});

describe("backoff actually backs off", () => {
  // The bug this pins: the old error text said "backing off" while the loop
  // carried on at full speed 1.5 seconds later.
  const fixed = () => ({ t: 0 });

  function harness() {
    const clock = fixed();
    const b = createBackoff({
      baseMs: 1_000,
      maxMs: 60_000,
      now: () => clock.t,
      random: () => 0.5, // jitter factor lands at exactly 1.0
    });
    return { b, clock };
  }

  it("grows exponentially", () => {
    const { b } = harness();
    expect(b.enter({})).toBe(1_000);
    expect(b.enter({})).toBe(2_000);
    expect(b.enter({})).toBe(4_000);
    expect(b.enter({})).toBe(8_000);
  });

  it("stops growing at the ceiling", () => {
    const { b } = harness();
    for (let i = 0; i < 20; i++) b.enter({});
    expect(b.enter({})).toBe(60_000);
  });

  it("is active until the wait elapses", () => {
    const { b, clock } = harness();
    const wait = b.enter({});
    expect(b.active()).toBe(true);
    expect(b.remaining()).toBe(wait);

    clock.t += wait - 1;
    expect(b.active()).toBe(true);

    clock.t += 1;
    expect(b.active()).toBe(false);
    expect(b.remaining()).toBe(0);
  });

  it("prefers the provider's Retry-After over its own guess", () => {
    const { b } = harness();
    expect(b.enter({ retryAfterMs: 30_000 })).toBe(30_000);
  });

  it("resets after a success, so one bad minute doesn't punish the next hour", () => {
    const { b } = harness();
    b.enter({});
    b.enter({});
    expect(b.failures).toBe(2);

    expect(b.clear()).toBe(true);
    expect(b.failures).toBe(0);
    expect(b.active()).toBe(false);
    // Next failure starts from the base delay again.
    expect(b.enter({})).toBe(1_000);
  });

  it("reports nothing to clear when it was never failing", () => {
    const { b } = harness();
    expect(b.clear()).toBe(false);
  });

  it("jitters within a sane band", () => {
    let r = 0;
    const b = createBackoff({ baseMs: 1_000, maxMs: 60_000, now: () => 0, random: () => r });
    r = 0; // lowest jitter
    expect(b.enter({})).toBe(850);
    b.clear();
    r = 1; // highest jitter
    expect(b.enter({})).toBeCloseTo(1_150, 5);
  });
});
