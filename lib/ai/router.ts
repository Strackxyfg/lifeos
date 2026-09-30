import OpenAI from "openai";

/**
 * The AI router: every model call in LifeOS goes through here.
 *
 * Why it exists. On Groq's free tier each model has its own quota — about
 * 1,000 requests a day and 8,000 tokens a minute, measured on 2026-09-22 —
 * and one exhausted quota used to mean "the AI is down" for everyone. The
 * router treats the configured models as a pool:
 *
 *  - Routing by task. Judging whether two notes are connected wants the
 *    strongest model; filing a thought wants a fast one; the chat wants the
 *    one that writes the language best. Each task ranks the routes by tier.
 *  - Failover. A route that fails is skipped and the next one answers; the
 *    person sees one answer, not an error.
 *  - Circuit breakers. A route that said "too many requests" is left alone
 *    until the time it gave (`retry-after`, or Groq's "try again in 1m26s");
 *    a provider that refused the key or asked for payment is left alone for
 *    an hour; a timeout or a 5xx for twenty seconds. Nothing hammers a quota
 *    that is already spent.
 *  - Model families. Qwen 3 reasons aloud unless told `/no_think`; gpt-oss
 *    spends part of `max_tokens` on reasoning it returns separately, and a
 *    ceiling sized only for the answer truncates the JSON (Groq then answers
 *    400 "Failed to generate JSON"). Both are handled here, once.
 *
 * Sovereignty. `AI_PROVIDER` picks the provider tried first; `AI_FALLBACK=0`
 * forbids leaving it. With `AI_PROVIDER=mistral AI_FALLBACK=0`, no text ever
 * reaches a model hosted outside the EU — failover then happens between that
 * provider's own models only.
 *
 * Breaker state lives in memory, per server instance. On serverless hosting
 * each instance learns on its own; that is the honest limit of it.
 */

export type Provider = "groq" | "cerebras" | "mistral";
export type Tier = "strong" | "balanced" | "fast";
export type AITask = "chat" | "classify" | "concepts" | "judge" | "steps" | "insight" | "atomize" | "decide" | "portrait";

export interface Route {
  /** "provider:model" — unique. */
  id: string;
  provider: Provider;
  model: string;
  baseURL: string;
  apiKey: string;
  tier: Tier;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface CompletionRequest {
  task: AITask;
  messages: ChatMessage[];
  /** Tokens for the answer itself; reasoning headroom is added per family. */
  maxTokens: number;
  temperature: number;
  json?: boolean;
  timeoutMs?: number;
  /**
   * Whether an answer is usable. One that is not — valid JSON of the wrong
   * shape, an empty list where one was required — is passed on to the next
   * model rather than returned as "nothing found". Not held against the route.
   */
  validate?: (text: string) => boolean;
}

/** A failure as the router sees it, whatever the transport. */
export class RouteError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    /** From `retry-after`, or parsed from the provider's own wording. */
    public readonly retryAfterMs?: number
  ) {
    super(message);
  }
}

/** What callers catch: every route was tried, or none exists. */
export class AIError extends Error {
  constructor(
    public readonly code: "unavailable" | "rate_limit" | "failed",
    message: string
  ) {
    super(message);
  }
}

/** How requests actually reach a provider. Swapped for a fake in tests. */
export interface Transport {
  complete(route: Route, body: Record<string, unknown>, timeoutMs: number): Promise<string>;
  /** Resolves once the stream is open; tokens then come through the iterable. */
  stream(route: Route, body: Record<string, unknown>, timeoutMs: number): Promise<AsyncIterable<string>>;
}

/* ── Configuration ────────────────────────────────────────────────── */

const PROVIDERS: Record<Provider, { baseURL: string; key: string; model: string; models: string; defaults: string[] }> = {
  groq: {
    baseURL: "https://api.groq.com/openai/v1",
    key: "GROQ_API_KEY",
    model: "GROQ_MODEL",
    models: "GROQ_MODELS",
    defaults: ["qwen/qwen3.8-27b", "openai/gpt-oss-120b", "openai/gpt-oss-20b"],
  },
  mistral: {
    // Mistral AI — Paris, hosted in the EU.
    baseURL: "https://api.mistral.ai/v1",
    key: "MISTRAL_API_KEY",
    model: "MISTRAL_MODEL",
    models: "MISTRAL_MODELS",
    defaults: ["mistral-small-latest", "mistral-medium-latest"],
  },
  cerebras: {
    baseURL: "https://api.cerebras.ai/v1",
    key: "CEREBRAS_API_KEY",
    model: "CEREBRAS_MODEL",
    models: "CEREBRAS_MODELS",
    // "llama-3.3-70b", the old default, is no longer served (checked 2026-09-22).
    defaults: ["qwen-3.8-27b", "gpt-oss-120b"],
  },
};

const PROVIDER_ORDER: Provider[] = ["groq", "mistral", "cerebras"];

export function tierOf(model: string): Tier {
  if (/gpt-oss-120b|large|medium/i.test(model)) return "strong";
  if (/gpt-oss-20b|\b\d{1,2}b\b|mini|nano|tiny|small-3b/i.test(model) && !/27b|32b|70b/i.test(model)) return "fast";
  return "balanced";
}

/**
 * Tiers each task prefers, best first — set from measurement, not from
 * parameter counts. On ten hand-labelled pairs of bilingual notes (2026-09-22)
 * qwen3.8-27b judged 9/10 correctly and gpt-oss-120b 8/10: the larger model
 * rated a real "moves forward" at 0.7, under the drawing threshold, which was
 * calibrated on qwen. So the balanced tier leads everywhere; the others are
 * the pool that keeps the brain answering when its quota is spent.
 */
export const TASK_TIERS: Record<AITask, Tier[]> = {
  chat: ["balanced", "strong", "fast"],
  classify: ["balanced", "fast", "strong"],
  concepts: ["balanced", "fast", "strong"],
  judge: ["balanced", "strong", "fast"],
  steps: ["balanced", "strong", "fast"],
  insight: ["balanced", "strong", "fast"],
  atomize: ["balanced", "strong", "fast"],
  decide: ["balanced", "strong", "fast"],
  portrait: ["balanced", "strong", "fast"],
};

const unique = <T>(xs: T[]) => [...new Set(xs)];
const list = (v: string | undefined) => (v ?? "").split(",").map((s) => s.trim()).filter(Boolean);

/** Routes from the environment, preferred provider first. */
export function routesFromEnv(env: Record<string, string | undefined>): Route[] {
  const preferred = PROVIDER_ORDER.includes(env.AI_PROVIDER as Provider) ? (env.AI_PROVIDER as Provider) : "groq";
  const fallback = !/^(0|false|off|no)$/i.test(env.AI_FALLBACK ?? "");
  const providers = [preferred, ...PROVIDER_ORDER.filter((p) => p !== preferred)].filter(
    (p) => p === preferred || fallback
  );

  const routes: Route[] = [];
  for (const provider of providers) {
    const cfg = PROVIDERS[provider];
    const apiKey = env[cfg.key];
    if (!apiKey) continue;
    const explicit = list(env[cfg.models]);
    const models = unique([...(env[cfg.model] ? [env[cfg.model] as string] : []), ...(explicit.length ? explicit : cfg.defaults)]);
    for (const model of models) {
      routes.push({ id: `${provider}:${model}`, provider, model, baseURL: cfg.baseURL, apiKey, tier: tierOf(model) });
    }
  }
  return routes;
}

/* ── Model families ───────────────────────────────────────────────── */

const isQwen3 = (model: string) => /qwen-?3/i.test(model);
const isGptOss = (model: string) => /gpt-oss/i.test(model);

/** Reasoning tokens gpt-oss spends at low effort, measured with room to spare. */
export const REASONING_HEADROOM = 400;

export function bodyFor(route: Route, req: CompletionRequest, stream: boolean): Record<string, unknown> {
  const messages = req.messages.map((m) => ({ ...m }));
  if (isQwen3(route.model)) {
    const last = [...messages].reverse().find((m) => m.role === "user");
    if (last && !last.content.includes("/no_think")) last.content = `${last.content}\n\n/no_think`;
  }
  const body: Record<string, unknown> = {
    model: route.model,
    messages,
    temperature: req.temperature,
    max_tokens: req.maxTokens + (isGptOss(route.model) ? REASONING_HEADROOM : 0),
    stream,
  };
  if (req.json) body.response_format = { type: "json_object" };
  if (isGptOss(route.model)) body.reasoning_effort = "low";
  return body;
}

/* ── Breakers ─────────────────────────────────────────────────────── */

/** "try again in 1m26.4s", "in 7.66s", "in 2h3m" → milliseconds. */
export function parseRetryAfter(text: string): number | undefined {
  const m = /try again in\s+((?:\d+h)?(?:\d+m(?!s))?(?:[\d.]+s)?(?:[\d.]+ms)?)/i.exec(text);
  if (!m || !m[1]) return undefined;
  const part = (re: RegExp) => Number.parseFloat(re.exec(m[1])?.[1] ?? "0");
  const ms =
    part(/(\d+)h/) * 3_600_000 +
    part(/(\d+)m(?!s)/) * 60_000 +
    part(/([\d.]+)s/) * 1000 +
    part(/([\d.]+)ms/);
  return ms > 0 ? Math.ceil(ms) : undefined;
}

const MINUTE = 60_000;

/**
 * How long to leave a route alone after an error, and whether the whole
 * provider is affected. A 400 is the request's or the model's output, not the
 * route's health: it fails over without tripping anything.
 */
export function breakerFor(err: RouteError): { ms: number; scope: "route" | "provider" } | null {
  const s = err.status;
  if (s === 429 || s === 413) return { ms: Math.min(err.retryAfterMs ?? MINUTE, 24 * 60 * MINUTE), scope: "route" };
  if (s === 401 || s === 402 || s === 403) return { ms: 60 * MINUTE, scope: "provider" };
  if (s === 404) return { ms: 60 * MINUTE, scope: "route" };
  if (s === 400 || s === 422) return null;
  return { ms: 20_000, scope: "route" }; // 5xx, timeouts, network
}

/* ── The router ───────────────────────────────────────────────────── */

export interface RouteHealth {
  id: string;
  tier: Tier;
  /** Epoch ms until which the route is skipped; 0 when available. */
  openUntil: number;
  lastError?: string;
}

export function createRouter(deps: { routes: Route[]; transport: Transport; now?: () => number }) {
  const now = deps.now ?? (() => Date.now());
  const openUntil = new Map<string, number>();
  const lastError = new Map<string, string>();

  const isOpen = (r: Route) => (openUntil.get(r.id) ?? 0) > now();

  const trip = (route: Route, err: RouteError) => {
    lastError.set(route.id, `${err.status ?? "network"}: ${err.message.slice(0, 200)}`);
    const b = breakerFor(err);
    if (!b) return;
    const until = now() + b.ms;
    const targets = b.scope === "provider" ? deps.routes.filter((r) => r.provider === route.provider) : [route];
    for (const t of targets) openUntil.set(t.id, Math.max(openUntil.get(t.id) ?? 0, until));
  };

  /** Routes for a task, best first; those with an open breaker last-resort only. */
  const routesFor = (task: AITask): Route[] => {
    const tiers = TASK_TIERS[task];
    const providerRank = new Map(unique(deps.routes.map((r) => r.provider)).map((p, i) => [p, i]));
    const index = new Map(deps.routes.map((r, i) => [r.id, i]));
    return [...deps.routes].sort(
      (a, b) =>
        (providerRank.get(a.provider) ?? 0) - (providerRank.get(b.provider) ?? 0) ||
        tiers.indexOf(a.tier) - tiers.indexOf(b.tier) ||
        (index.get(a.id) ?? 0) - (index.get(b.id) ?? 0)
    );
  };

  const toError = (failures: RouteError[], skipped: number): AIError => {
    if (deps.routes.length === 0) return new AIError("unavailable", "No AI provider is configured.");
    const limited = failures.filter((f) => f.status === 429 || f.status === 413).length;
    // Every route either said "too many requests" or was resting after saying so.
    if (failures.length === limited && (limited > 0 || skipped > 0)) {
      return new AIError("rate_limit", "Every model's rate limit is reached for now.");
    }
    const last = failures[failures.length - 1];
    return new AIError("failed", last ? last.message : "Every model is resting after errors.");
  };

  async function attempt<T>(req: CompletionRequest, call: (route: Route) => Promise<T>): Promise<{ value: T; route: Route }> {
    const failures: RouteError[] = [];
    let skipped = 0;
    for (const route of routesFor(req.task)) {
      if (isOpen(route)) {
        skipped++;
        continue;
      }
      try {
        const value = await call(route);
        lastError.delete(route.id);
        return { value, route };
      } catch (e) {
        const err = e instanceof RouteError ? e : new RouteError(e instanceof Error ? e.message : String(e));
        failures.push(err);
        trip(route, err);
      }
    }
    throw toError(failures, skipped);
  }

  return {
    routes: deps.routes,
    available: () => deps.routes.length > 0,
    routesFor,

    /** One completion, from the first route that answers. */
    complete: (req: CompletionRequest) =>
      attempt(req, async (route) => {
        const text = await deps.transport.complete(route, bodyFor(route, req, false), req.timeoutMs ?? 30_000);
        if (req.validate && !req.validate(text)) throw new RouteError(`Unusable answer from ${route.id}`, 422);
        return text;
      }),

    /**
     * A streamed completion. Failover happens until the first token arrives;
     * after that the answer belongs to one model, and a failure mid-way is
     * the caller's to report.
     */
    async stream(req: CompletionRequest): Promise<{ tokens: AsyncIterable<string>; route: Route }> {
      const { value, route } = await attempt(req, async (r) => {
        const it = (await deps.transport.stream(r, bodyFor(r, req, true), req.timeoutMs ?? 30_000))[Symbol.asyncIterator]();
        const first = await it.next(); // errors before any token count as the route's
        return { it, first };
      });
      const tokens = {
        async *[Symbol.asyncIterator]() {
          if (!value.first.done) yield value.first.value;
          while (true) {
            const next = await value.it.next();
            if (next.done) return;
            yield next.value;
          }
        },
      };
      return { tokens, route };
    },

    health: (): RouteHealth[] =>
      deps.routes.map((r) => ({
        id: r.id,
        tier: r.tier,
        openUntil: isOpen(r) ? openUntil.get(r.id) ?? 0 : 0,
        lastError: lastError.get(r.id),
      })),
  };
}

export type Router = ReturnType<typeof createRouter>;

/* ── The real transport ───────────────────────────────────────────── */

const clients = new Map<string, OpenAI>();
export function clientFor(route: Pick<Route, "baseURL" | "apiKey">): OpenAI {
  const key = `${route.baseURL}|${route.apiKey.slice(-6)}`;
  let c = clients.get(key);
  if (!c) {
    // No SDK retries: a retry waits out the provider's retry-after — up to a
    // minute of spinner — when the next route could answer at once.
    c = new OpenAI({ apiKey: route.apiKey, baseURL: route.baseURL, maxRetries: 0 });
    clients.set(key, c);
  }
  return c;
}

export function toRouteError(e: unknown): RouteError {
  if (e instanceof OpenAI.APIError) {
    const header = (e.headers as Record<string, string> | undefined)?.["retry-after"];
    const fromHeader = header && Number.isFinite(Number(header)) ? Number(header) * 1000 : undefined;
    return new RouteError(e.message, e.status, fromHeader ?? parseRetryAfter(e.message));
  }
  if (e instanceof RouteError) return e;
  return new RouteError(e instanceof Error ? e.message : String(e));
}

export const httpTransport: Transport = {
  async complete(route, body, timeoutMs) {
    try {
      const r = (await clientFor(route).chat.completions.create(body as never, { timeout: timeoutMs })) as OpenAI.Chat.Completions.ChatCompletion;
      return r.choices[0]?.message?.content ?? "";
    } catch (e) {
      throw toRouteError(e);
    }
  },
  async stream(route, body, timeoutMs) {
    let raw: AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>;
    try {
      raw = (await clientFor(route).chat.completions.create(body as never, { timeout: timeoutMs })) as never;
    } catch (e) {
      throw toRouteError(e);
    }
    return {
      async *[Symbol.asyncIterator]() {
        try {
          for await (const chunk of raw) {
            // Reasoning models stream their reasoning in a separate field;
            // only the answer is the person's to read.
            const token = chunk.choices[0]?.delta?.content ?? "";
            if (token) yield token;
          }
        } catch (e) {
          throw toRouteError(e);
        }
      },
    };
  },
};

/* ── The process-wide router ──────────────────────────────────────── */

let shared: Router | null = null;

/** The router for this server instance, built from the environment once. */
export function ai(): Router {
  shared ??= createRouter({ routes: routesFromEnv(process.env), transport: httpTransport });
  return shared;
}

/** Whether any model is configured. */
export function aiAvailable(): boolean {
  return ai().available();
}
