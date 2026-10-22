import {
  RouteError,
  type AITask,
  type Api,
  type CompletionRequest,
  type Provider,
  type Route,
  type Tier,
  type Transport,
  type TurnRequest,
  type TurnResult,
} from "./types";
import { chatTransport } from "./providers/chat";
import { anthropicTransport } from "./providers/anthropic";
import { responsesTransport } from "./providers/responses";

export { RouteError } from "./types";
export type { AITask, Api, ChatMessage, CompletionRequest, Provider, Route, Tier, Transport } from "./types";
export { REASONING_HEADROOM, bodyFor, clientFor, parseRetryAfter, toRouteError } from "./providers/chat";

/**
 * The AI router: every model call in LifeOS goes through here.
 *
 * Why it exists. Each provider, each model, has its own quota and its own
 * bad days. One exhausted quota used to mean "the AI is down" for everyone.
 * The router treats the configured models as a pool:
 *
 *  - Routing by task and by tier. Filing a thought wants a fast model; the
 *    agent, which plans and calls tools, wants the strongest reasoning model
 *    available — the "frontier" tier (Claude Opus/Sonnet, GPT-6 Sol/Astra,
 *    DeepSeek V4 Pro, Kimi K3…). Everyday features keep the pool they were
 *    measured on.
 *  - Failover. A route that fails is skipped and the next one answers; the
 *    person sees one answer, not an error.
 *  - Circuit breakers. A route that said "too many requests" is left alone
 *    until the time it gave; a provider that refused the key or asked for
 *    payment is left alone for an hour; a timeout or a 5xx for twenty
 *    seconds. Nothing hammers a quota that is already spent.
 *  - Three protocols behind one interface (`lib/ai/providers/`): Chat
 *    Completions (Groq, Mistral, Cerebras, DeepSeek, OpenRouter), Anthropic
 *    Messages, OpenAI Responses — each with tool calling.
 *
 * Sovereignty. `AI_PROVIDER` picks the provider tried first; `AI_FALLBACK=0`
 * forbids leaving it. With `AI_PROVIDER=mistral AI_FALLBACK=0`, no text ever
 * reaches a model hosted outside the EU.
 *
 * Breaker state lives in memory, per server instance. On serverless hosting
 * each instance learns on its own; that is the honest limit of it.
 */

/** What callers catch: every route was tried, or none exists. */
export class AIError extends Error {
  constructor(
    public readonly code: "unavailable" | "rate_limit" | "failed",
    message: string
  ) {
    super(message);
  }
}

/* ── Configuration ────────────────────────────────────────────────── */

interface ProviderConfig {
  baseURL: string;
  /** Environment variable holding the key, the preferred model, the model list. */
  key: string;
  model: string;
  models: string;
  defaults: string[];
  api: Api;
  /** Hosted in the EU. */
  eu?: boolean;
  label: string;
}

export const PROVIDERS: Record<Provider, ProviderConfig> = {
  groq: {
    baseURL: "https://api.groq.com/openai/v1",
    key: "GROQ_API_KEY",
    model: "GROQ_MODEL",
    models: "GROQ_MODELS",
    defaults: ["qwen/qwen3.8-27b", "openai/gpt-oss-120b", "openai/gpt-oss-20b"],
    api: "chat",
    label: "Groq",
  },
  mistral: {
    // Mistral AI — Paris, hosted in the EU.
    baseURL: "https://api.mistral.ai/v1",
    key: "MISTRAL_API_KEY",
    model: "MISTRAL_MODEL",
    models: "MISTRAL_MODELS",
    defaults: ["mistral-small-latest", "mistral-medium-latest"],
    api: "chat",
    eu: true,
    label: "Mistral AI",
  },
  cerebras: {
    baseURL: "https://api.cerebras.ai/v1",
    key: "CEREBRAS_API_KEY",
    model: "CEREBRAS_MODEL",
    models: "CEREBRAS_MODELS",
    // "llama-3.3-70b", the old default, is no longer served (checked 2026-09-22).
    defaults: ["qwen-3.8-27b", "gpt-oss-120b"],
    api: "chat",
    label: "Cerebras",
  },
  deepseek: {
    // Model names from the official docs, 2026-10-22: `deepseek-flash` is V4.1-Flash, `deepseek-v4-pro` the Pro model.
    baseURL: "https://api.deepseek.com",
    key: "DEEPSEEK_API_KEY",
    model: "DEEPSEEK_MODEL",
    models: "DEEPSEEK_MODELS",
    defaults: ["deepseek-v4-pro", "deepseek-flash"],
    api: "chat",
    label: "DeepSeek",
  },
  openrouter: {
    // One key, many models. Ids checked against openrouter.ai/api/v1/models on 2026-10-22, all with tool calling.
    baseURL: "https://openrouter.ai/api/v1",
    key: "OPENROUTER_API_KEY",
    model: "OPENROUTER_MODEL",
    models: "OPENROUTER_MODELS",
    defaults: ["moonshotai/kimi-k3", "deepseek/deepseek-v4-pro", "z-ai/glm-5.3"],
    api: "chat",
    label: "OpenRouter",
  },
  anthropic: {
    baseURL: "https://api.anthropic.com",
    key: "ANTHROPIC_API_KEY",
    model: "ANTHROPIC_MODEL",
    models: "ANTHROPIC_MODELS",
    defaults: ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"],
    api: "anthropic",
    label: "Anthropic",
  },
  openai: {
    // Ids from OpenAI's model pages, 2026-10-22. Tool calling needs the Responses API.
    baseURL: "https://api.openai.com/v1",
    key: "OPENAI_API_KEY",
    model: "OPENAI_MODEL",
    models: "OPENAI_MODELS",
    defaults: ["gpt-6.1-sol", "gpt-6-luna"],
    api: "responses",
    label: "OpenAI",
  },
};

export const PROVIDER_ORDER: Provider[] = ["groq", "mistral", "cerebras", "deepseek", "openrouter", "anthropic", "openai"];

/** Every tier, strongest first — how unlisted tiers are ordered after a task's own. */
const TIER_ORDER: Tier[] = ["frontier", "strong", "balanced", "fast"];

export function tierOf(model: string): Tier {
  const m = model.toLowerCase();
  if (
    /claude-(opus|fable|mythos|sonnet)|gpt-6(\.\d+)?-(astra|sol)|gpt-5\.\d+-sol|deepseek-v4-pro|kimi-k3|kimi-k2\.[6-9]|glm-5\.\d+-prime|qwen3\.\d+-max/.test(m)
  ) {
    return "frontier";
  }
  if (/gpt-oss-120b|large|medium|deepseek-flash|deepseek-v4(\.\d)?-flash|glm-5|kimi|qwen3\.\d+-plus/.test(m)) return "strong";
  if (/haiku|luna/.test(m)) return "balanced";
  if (/gpt-oss-20b|\b\d{1,2}b\b|mini|nano|tiny|small-3b/i.test(model) && !/27b|32b|70b/i.test(model)) return "fast";
  return "balanced";
}

/**
 * Tiers each task prefers, best first — set from measurement, not from
 * parameter counts. On ten hand-labelled pairs of bilingual notes (2026-09-22)
 * qwen3.8-27b judged 9/10 correctly and gpt-oss-120b 8/10, so the balanced
 * tier leads the everyday features. The agent is different work: planning
 * and calling tools over many steps, where the frontier models lead every
 * agent benchmark by a wide margin.
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
  maps: ["balanced", "fast", "strong"],
  agent: ["frontier", "strong", "balanced", "fast"],
};

const unique = <T>(xs: T[]) => [...new Set(xs)];
const list = (v: string | undefined) => (v ?? "").split(",").map((s) => s.trim()).filter(Boolean);

/** Routes from the environment, preferred provider first. */
export function routesFromEnv(env: Record<string, string | undefined>): Route[] {
  const preferred = PROVIDER_ORDER.includes(env.AI_PROVIDER as Provider) ? (env.AI_PROVIDER as Provider) : "groq";
  const fallback = !/^(0|false|off|no)$/i.test(env.AI_FALLBACK ?? "");
  const providers = [preferred, ...PROVIDER_ORDER.filter((p) => p !== preferred)].filter((p) => p === preferred || fallback);

  const routes: Route[] = [];
  for (const provider of providers) {
    const cfg = PROVIDERS[provider];
    const apiKey = env[cfg.key];
    if (!apiKey) continue;
    const explicit = list(env[cfg.models]);
    const models = unique([...(env[cfg.model] ? [env[cfg.model] as string] : []), ...(explicit.length ? explicit : cfg.defaults)]);
    for (const model of models) {
      routes.push({ id: `${provider}:${model}`, provider, model, baseURL: cfg.baseURL, apiKey, tier: tierOf(model), api: cfg.api });
    }
  }
  return routes;
}

/* ── Breakers ─────────────────────────────────────────────────────── */

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
  provider: Provider;
  model: string;
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

  /**
   * Routes for a task, best first. Everyday tasks keep the preferred
   * provider's models together (the sovereignty preference, and the order
   * they were measured in); a task that wants the frontier tier gets the
   * strongest models first, from whichever provider has them.
   */
  const routesFor = (task: AITask, prefer?: Tier[]): Route[] => {
    const tiers = prefer?.length ? prefer : TASK_TIERS[task];
    const tierRank = (t: Tier) => {
      const i = tiers.indexOf(t);
      return i >= 0 ? i : tiers.length + TIER_ORDER.indexOf(t);
    };
    const providerRank = new Map(unique(deps.routes.map((r) => r.provider)).map((p, i) => [p, i]));
    const index = new Map(deps.routes.map((r, i) => [r.id, i]));
    const capabilityFirst = tiers[0] === "frontier";
    return [...deps.routes].sort((a, b) => {
      const byTier = tierRank(a.tier) - tierRank(b.tier);
      const byProvider = (providerRank.get(a.provider) ?? 0) - (providerRank.get(b.provider) ?? 0);
      const byIndex = (index.get(a.id) ?? 0) - (index.get(b.id) ?? 0);
      return capabilityFirst ? byTier || byProvider || byIndex : byProvider || byTier || byIndex;
    });
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

  const asRouteError = (e: unknown) => (e instanceof RouteError ? e : new RouteError(e instanceof Error ? e.message : String(e)));

  async function attempt<T>(order: Route[], call: (route: Route) => Promise<T>): Promise<{ value: T; route: Route }> {
    const failures: RouteError[] = [];
    let skipped = 0;
    for (const route of order) {
      if (isOpen(route)) {
        skipped++;
        continue;
      }
      try {
        const value = await call(route);
        lastError.delete(route.id);
        return { value, route };
      } catch (e) {
        const err = asRouteError(e);
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
      attempt(routesFor(req.task, req.prefer), async (route) => {
        const text = await deps.transport.complete(route, req, req.timeoutMs ?? 30_000);
        if (req.validate && !req.validate(text)) throw new RouteError(`Unusable answer from ${route.id}`, 422);
        return text;
      }),

    /**
     * A streamed completion. Failover happens until the first token arrives;
     * after that the answer belongs to one model, and a failure mid-way is
     * the caller's to report.
     */
    async stream(req: CompletionRequest): Promise<{ tokens: AsyncIterable<string>; route: Route }> {
      const { value, route } = await attempt(routesFor(req.task, req.prefer), async (r) => {
        const it = (await deps.transport.stream(r, req, req.timeoutMs ?? 30_000))[Symbol.asyncIterator]();
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

    /**
     * One step of a tool-using conversation. The route that began the
     * conversation is tried first (its own reasoning can then be sent back);
     * failover happens until the first visible word — after that, a failure
     * is the caller's, since the person has already started reading.
     */
    async turn(req: TurnRequest): Promise<TurnResult> {
      if (!deps.transport.turn) throw new AIError("unavailable", "This transport cannot call tools.");
      const ordered = routesFor(req.task, req.prefer);
      const sticky = req.stickTo ? ordered.find((r) => r.id === req.stickTo) : undefined;
      const order = sticky ? [sticky, ...ordered.filter((r) => r !== sticky)] : ordered;
      const failures: RouteError[] = [];
      let skipped = 0;
      for (const route of order) {
        if (isOpen(route)) {
          skipped++;
          continue;
        }
        let started = false;
        try {
          const out = await deps.transport.turn(route, {
            ...req,
            onText: req.onText
              ? (delta) => {
                  started = true;
                  req.onText!(delta);
                }
              : undefined,
          });
          lastError.delete(route.id);
          return { ...out, route };
        } catch (e) {
          const err = asRouteError(e);
          failures.push(err);
          trip(route, err);
          if (started || req.signal?.aborted) throw new AIError("failed", err.message);
        }
      }
      throw toError(failures, skipped);
    },

    health: (): RouteHealth[] =>
      deps.routes.map((r) => ({
        id: r.id,
        provider: r.provider,
        model: r.model,
        tier: r.tier,
        openUntil: isOpen(r) ? openUntil.get(r.id) ?? 0 : 0,
        lastError: lastError.get(r.id),
      })),
  };
}

export type Router = ReturnType<typeof createRouter>;

/* ── The real transport ───────────────────────────────────────────── */

const pick = (route: Route) => (route.api === "anthropic" ? anthropicTransport : route.api === "responses" ? responsesTransport : chatTransport);

export const httpTransport: Transport = {
  complete: (route, req, timeoutMs) => pick(route).complete(route, req, timeoutMs),
  stream: (route, req, timeoutMs) => pick(route).stream(route, req, timeoutMs),
  turn: (route, req) => pick(route).turn(route, req),
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

/** Whether a model of the frontier tier is configured (the agent's best). */
export function frontierAvailable(): boolean {
  return ai().routes.some((r) => r.tier === "frontier");
}
