import { describe, it, expect } from "vitest";
import {
  AIError, RouteError, REASONING_HEADROOM, bodyFor, breakerFor, createRouter, parseRetryAfter, routesFromEnv, tierOf,
  type Route, type Transport,
} from "@/lib/ai/router";

const routes = routesFromEnv({ GROQ_API_KEY: "g", GROQ_MODEL: "qwen/qwen3.8-27b" });
const byModel = (m: string) => routes.find((r) => r.model === m)!;

/** A transport that answers from a script: model → sequence of outcomes. */
function scripted(script: Record<string, (Error | string)[]>) {
  const calls: string[] = [];
  const next = (route: Route) => {
    calls.push(route.model);
    const queue = script[route.model] ?? [];
    const outcome = queue.length > 1 ? queue.shift()! : queue[0];
    if (outcome === undefined) throw new RouteError("no script", 500);
    if (outcome instanceof Error) throw outcome;
    return outcome;
  };
  const transport: Transport = {
    async complete(route) {
      return next(route);
    },
    async stream(route) {
      const text = next(route);
      return {
        async *[Symbol.asyncIterator]() {
          for (const t of text.split(" ")) {
            if (t === "BOOM") throw new RouteError("cut", 500);
            yield t;
          }
        },
      };
    },
  };
  return { transport, calls };
}

const req = { task: "judge" as const, messages: [{ role: "user" as const, content: "x" }], maxTokens: 100, temperature: 0, json: true };

describe("configuration", () => {
  it("builds a pool from every configured provider, preferred first", () => {
    const r = routesFromEnv({ GROQ_API_KEY: "g", MISTRAL_API_KEY: "m", AI_PROVIDER: "mistral" });
    expect(r.map((x) => x.id)).toEqual([
      "mistral:mistral-small-latest",
      "mistral:mistral-medium-latest",
      "groq:qwen/qwen3.8-27b",
      "groq:openai/gpt-oss-120b",
      "groq:openai/gpt-oss-20b",
    ]);
  });

  it("never leaves the chosen provider when fallback is off — the sovereign setting", () => {
    const r = routesFromEnv({ GROQ_API_KEY: "g", MISTRAL_API_KEY: "m", AI_PROVIDER: "mistral", AI_FALLBACK: "0" });
    expect(new Set(r.map((x) => x.provider))).toEqual(new Set(["mistral"]));
  });

  it("puts an explicitly configured model first and keeps the rest of the pool", () => {
    const r = routesFromEnv({ CEREBRAS_API_KEY: "c", CEREBRAS_MODEL: "llama-3.3-70b", AI_PROVIDER: "cerebras" });
    expect(r.map((x) => x.model)).toEqual(["llama-3.3-70b", "qwen-3.8-27b", "gpt-oss-120b"]);
  });

  it("has no route without a key", () => {
    expect(routesFromEnv({})).toEqual([]);
    expect(createRouter({ routes: [], transport: scripted({}).transport }).available()).toBe(false);
  });

  it("ranks models into tiers", () => {
    expect(tierOf("openai/gpt-oss-120b")).toBe("strong");
    expect(tierOf("mistral-medium-latest")).toBe("strong");
    expect(tierOf("qwen/qwen3.8-27b")).toBe("balanced");
    expect(tierOf("mistral-small-latest")).toBe("balanced");
    expect(tierOf("openai/gpt-oss-20b")).toBe("fast");
    expect(tierOf("llama-3.1-8b-instant")).toBe("fast");
  });

  it("orders the pool per task, from measurement", () => {
    const router = createRouter({ routes, transport: scripted({}).transport });
    expect(router.routesFor("judge").map((r) => r.model)).toEqual(["qwen/qwen3.8-27b", "openai/gpt-oss-120b", "openai/gpt-oss-20b"]);
    expect(router.routesFor("classify").map((r) => r.model)).toEqual(["qwen/qwen3.8-27b", "openai/gpt-oss-20b", "openai/gpt-oss-120b"]);
  });
});

describe("model families", () => {
  it("tells Qwen 3 not to think aloud, once", () => {
    const body = bodyFor(byModel("qwen/qwen3.8-27b"), req, false) as { messages: { content: string }[] };
    expect(body.messages[0].content).toBe("x\n\n/no_think");
    const again = bodyFor(byModel("qwen/qwen3.8-27b"), { ...req, messages: [{ role: "user", content: "y /no_think" }] }, false) as { messages: { content: string }[] };
    expect(again.messages[0].content).toBe("y /no_think");
  });

  it("gives gpt-oss room for its reasoning, at low effort", () => {
    const body = bodyFor(byModel("openai/gpt-oss-120b"), req, false);
    expect(body.max_tokens).toBe(100 + REASONING_HEADROOM);
    expect(body.reasoning_effort).toBe("low");
    expect(body.response_format).toEqual({ type: "json_object" });
  });

  it("never mutates the caller's messages", () => {
    const messages = [{ role: "user" as const, content: "x" }];
    bodyFor(byModel("qwen/qwen3.8-27b"), { ...req, messages }, false);
    expect(messages[0].content).toBe("x");
  });
});

describe("retry-after", () => {
  it("reads the provider's own wording", () => {
    expect(parseRetryAfter("Rate limit reached. Please try again in 1m26.4s. Need more tokens?")).toBe(86_400);
    expect(parseRetryAfter("try again in 7.66s")).toBe(7_660);
    expect(parseRetryAfter("try again in 2h3m")).toBe(7_380_000);
    expect(parseRetryAfter("try again in 500ms")).toBe(500);
    expect(parseRetryAfter("no hint here")).toBeUndefined();
  });

  it("rests a route by the error, the whole provider for a refused key", () => {
    expect(breakerFor(new RouteError("x", 429, 5_000))).toEqual({ ms: 5_000, scope: "route" });
    expect(breakerFor(new RouteError("x", 402))).toEqual({ ms: 3_600_000, scope: "provider" });
    expect(breakerFor(new RouteError("x", 503))).toEqual({ ms: 20_000, scope: "route" });
    // Bad JSON from one model is not the route's health.
    expect(breakerFor(new RouteError("Failed to generate JSON", 400))).toBeNull();
  });
});

describe("failover", () => {
  it("answers from the next model when the first one's quota is spent, and rests it", async () => {
    let t = 0;
    const { transport, calls } = scripted({
      "qwen/qwen3.8-27b": [new RouteError("try again in 30s", 429, 30_000)],
      "openai/gpt-oss-120b": ["ok"],
    });
    const router = createRouter({ routes, transport, now: () => t });
    const first = await router.complete(req);
    expect(first).toMatchObject({ value: "ok", route: { model: "openai/gpt-oss-120b" } });
    expect(calls).toEqual(["qwen/qwen3.8-27b", "openai/gpt-oss-120b"]);

    // Within the rest period the tired route is not even asked.
    await router.complete(req);
    expect(calls).toEqual(["qwen/qwen3.8-27b", "openai/gpt-oss-120b", "openai/gpt-oss-120b"]);

    // Afterwards it is tried first again.
    t = 31_000;
    await router.complete(req).catch(() => undefined);
    expect(calls[3]).toBe("qwen/qwen3.8-27b");
  });

  it("fails over on a model's bad JSON without resting it", async () => {
    const { transport, calls } = scripted({
      "qwen/qwen3.8-27b": [new RouteError("Failed to generate JSON", 400), "ok"],
      "openai/gpt-oss-120b": ["fallback"],
    });
    const router = createRouter({ routes, transport });
    expect((await router.complete(req)).value).toBe("fallback");
    expect((await router.complete(req)).value).toBe("ok");
    expect(calls).toEqual(["qwen/qwen3.8-27b", "openai/gpt-oss-120b", "qwen/qwen3.8-27b"]);
  });

  it("asks the next model when an answer parses but is unusable, without resting the first", async () => {
    const { transport, calls } = scripted({
      "qwen/qwen3.8-27b": ['{"verdicts": "no"}', '{"verdicts": []}'],
      "openai/gpt-oss-120b": ['{"verdicts": []}'],
    });
    const router = createRouter({ routes, transport });
    const validate = (t: string) => Array.isArray((JSON.parse(t) as { verdicts?: unknown }).verdicts);
    expect((await router.complete({ ...req, validate })).route.model).toBe("openai/gpt-oss-120b");
    expect((await router.complete({ ...req, validate })).route.model).toBe("qwen/qwen3.8-27b");
    expect(calls).toEqual(["qwen/qwen3.8-27b", "openai/gpt-oss-120b", "qwen/qwen3.8-27b"]);
  });

  it("rests every model of a provider that refused the key", async () => {
    const both = routesFromEnv({ CEREBRAS_API_KEY: "c", GROQ_API_KEY: "g", AI_PROVIDER: "cerebras" });
    // Cerebras's first model says 402: its other model must rest too and is
    // never asked; Groq answers.
    const { transport, calls } = scripted({
      "qwen-3.8-27b": [new RouteError("Payment required", 402)],
      "gpt-oss-120b": ["never called"],
      "qwen/qwen3.8-27b": ["groq answers"],
    });
    const router = createRouter({ routes: both, transport });
    expect((await router.complete(req)).value).toBe("groq answers");
    expect(calls).toEqual(["qwen-3.8-27b", "qwen/qwen3.8-27b"]);
    expect(router.health().filter((h) => h.openUntil > 0).map((h) => h.id)).toEqual([
      "cerebras:qwen-3.8-27b",
      "cerebras:gpt-oss-120b",
    ]);
  });

  it("says 'rate limit' when every model is resting from one, 'failed' otherwise", async () => {
    const limited = scripted(Object.fromEntries(routes.map((r) => [r.model, [new RouteError("slow down", 429)]])));
    const router = createRouter({ routes, transport: limited.transport });
    await expect(router.complete(req)).rejects.toMatchObject({ code: "rate_limit" });
    // Everything is resting now: still a rate limit, and nothing is called.
    const before = limited.calls.length;
    await expect(router.complete(req)).rejects.toMatchObject({ code: "rate_limit" });
    expect(limited.calls.length).toBe(before);

    const broken = createRouter({ routes, transport: scripted(Object.fromEntries(routes.map((r) => [r.model, [new RouteError("bad", 400)]]))).transport });
    await expect(broken.complete(req)).rejects.toMatchObject({ code: "failed" });

    await expect(createRouter({ routes: [], transport: limited.transport }).complete(req)).rejects.toBeInstanceOf(AIError);
  });
});

describe("streaming", () => {
  const chat = { ...req, task: "chat" as const, json: false };

  it("fails over when a stream breaks before its first token", async () => {
    const { transport, calls } = scripted({
      "qwen/qwen3.8-27b": ["BOOM"],
      "openai/gpt-oss-120b": ["hello there"],
    });
    const router = createRouter({ routes, transport });
    const { tokens, route } = await router.stream(chat);
    let text = "";
    for await (const t of tokens) text += `${t} `;
    expect(text.trim()).toBe("hello there");
    expect(route.model).toBe("openai/gpt-oss-120b");
    expect(calls).toEqual(["qwen/qwen3.8-27b", "openai/gpt-oss-120b"]);
  });

  it("keeps the model that started answering, and lets a later break surface", async () => {
    const { transport } = scripted({ "qwen/qwen3.8-27b": ["one two BOOM"] });
    const router = createRouter({ routes, transport });
    const { tokens } = await router.stream(chat);
    const got: string[] = [];
    await expect(
      (async () => {
        for await (const t of tokens) got.push(t);
      })()
    ).rejects.toThrow("cut");
    expect(got).toEqual(["one", "two"]);
  });
});
