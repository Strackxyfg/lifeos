import Anthropic from "@anthropic-ai/sdk";
import {
  RouteError,
  type AgentMessage,
  type CompletionRequest,
  type Route,
  type ToolCall,
  type TurnOutput,
  type TurnRequest,
} from "../types";

/**
 * Claude, through the official SDK and its own Messages protocol — not an
 * OpenAI-compatible shim, which would lose tool use and thinking.
 *
 * What the current models (Opus 5.5, Sonnet 5.5, Haiku 5.5, Fable 5.1) ask:
 *  - Thinking is adaptive and on; depth is set with `output_config.effort`.
 *    `temperature`, `top_p`, `top_k` are refused (400) since 2026-10-21.
 *  - Forcing a tool (`tool_choice` any/tool) is refused: the default `auto`.
 *  - In a tool loop, the assistant's content — thinking blocks included — goes
 *    back unchanged on the next request, to the same model only.
 *  - A refused request (`stop_reason: "refusal"`) is re-run server-side on a
 *    fallback model when `fallbacks: "default"` is sent (beta; on by default
 *    here, `ANTHROPIC_FALLBACKS=0` turns it off).
 */

const clients = new Map<string, Anthropic>();
function clientFor(route: Route): Anthropic {
  const key = `${route.baseURL}|${route.apiKey.slice(-6)}`;
  let c = clients.get(key);
  if (!c) {
    // No SDK retries: the router fails over to the next model instead of waiting out a rate limit.
    c = new Anthropic({ apiKey: route.apiKey, baseURL: route.baseURL, maxRetries: 0 });
    clients.set(key, c);
  }
  return c;
}

const FALLBACK_BETA = "server-side-fallback-2026-07-01";
/** Models that accept the server-side refusal fallback in its "default" form. */
const hasFallback = (model: string) => /claude-(opus-5|fable-5|sonnet-5-5)/.test(model);
const fallbacksOn = () => !/^(0|false|off|no)$/i.test(process.env.ANTHROPIC_FALLBACKS ?? "");

function headerOf(headers: unknown, name: string): string | undefined {
  if (!headers) return undefined;
  if (typeof (headers as Headers).get === "function") return (headers as Headers).get(name) ?? undefined;
  return (headers as Record<string, string>)[name];
}

function toRouteError(e: unknown): RouteError {
  if (e instanceof Anthropic.APIError) {
    const retry = Number(headerOf(e.headers, "retry-after"));
    return new RouteError(e.message, e.status, Number.isFinite(retry) && retry > 0 ? retry * 1000 : undefined);
  }
  if (e instanceof RouteError) return e;
  return new RouteError(e instanceof Error ? e.message : String(e));
}

/** Tool-use ids Claude accepts: letters, digits, `_` and `-`. */
export const anthropicId = (id: string) => id.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64) || "call";

type Block = Record<string, unknown>;

/** A conversation in Messages shape, for this route: system apart, tool results grouped. */
export function toAnthropic(route: Route, messages: AgentMessage[]): { system: string; messages: { role: "user" | "assistant"; content: string | Block[] }[] } {
  const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
  const out: { role: "user" | "assistant"; content: string | Block[] }[] = [];
  let results: Block[] = [];
  const flush = () => {
    if (results.length) out.push({ role: "user", content: results });
    results = [];
  };
  for (const m of messages) {
    if (m.role === "system") continue;
    if (m.role === "tool") {
      results.push({ type: "tool_result", tool_use_id: anthropicId(m.toolCallId), content: m.content, ...(m.isError ? { is_error: true } : {}) });
      continue;
    }
    flush();
    if (m.role === "user") {
      out.push({ role: "user", content: m.content });
    } else if (m.replay?.provider === "anthropic" && m.replay.model === route.model && Array.isArray(m.replay.data)) {
      // The same model's own turn: back unchanged, thinking blocks and all.
      out.push({ role: "assistant", content: m.replay.data as Block[] });
    } else {
      const blocks: Block[] = [];
      if (m.content.trim()) blocks.push({ type: "text", text: m.content });
      for (const c of m.toolCalls ?? []) blocks.push({ type: "tool_use", id: anthropicId(c.id), name: c.name, input: c.arguments });
      if (blocks.length) out.push({ role: "assistant", content: blocks });
    }
  }
  flush();
  // The conversation must open with the person.
  if (out[0]?.role !== "user") out.unshift({ role: "user", content: "…" });
  return { system, messages: out };
}

const EXTRA = (model: string): Record<string, unknown> =>
  hasFallback(model) && fallbacksOn() ? { betas: [FALLBACK_BETA], fallbacks: "default" } : { betas: [] };

/** Runs a request; when the refusal-fallback parameter itself is what was refused, once more without it. */
async function withFallbackRetry<T>(model: string, run: (extra: Record<string, unknown>) => Promise<T>): Promise<T> {
  const extra = EXTRA(model);
  try {
    return await run(extra);
  } catch (e) {
    if (e instanceof Anthropic.BadRequestError && "fallbacks" in extra && /fallback/i.test(e.message)) return run({ betas: [] });
    throw e;
  }
}

const textOf = (content: { type: string; text?: string }[]) =>
  content
    .filter((b) => b.type === "text")
    .map((b) => b.text ?? "")
    .join("");

const stopOf = (reason: string | null | undefined, calls: number): TurnOutput["stop"] =>
  calls > 0 && reason !== "max_tokens" && reason !== "refusal"
    ? "tool_calls"
    : reason === "end_turn" || reason === "stop_sequence"
      ? "end"
      : reason === "max_tokens"
        ? "max_tokens"
        : reason === "refusal"
          ? "refusal"
          : reason === "tool_use"
            ? "tool_calls"
            : "other";

/** Thinking runs inside `max_tokens`: room for it on top of what the answer needs. */
const THINKING_HEADROOM = { quick: 2_048, agent: 8_000 };

export const anthropicTransport = {
  async complete(route: Route, req: CompletionRequest, timeoutMs: number): Promise<string> {
    const { system, messages } = toAnthropic(route, req.messages);
    try {
      const msg = await withFallbackRetry(route.model, (extra) =>
        clientFor(route).beta.messages.create(
          {
            model: route.model,
            max_tokens: req.maxTokens + THINKING_HEADROOM.quick,
            ...(system ? { system: req.json ? `${system}\n\nAnswer with JSON only.` : system } : {}),
            messages,
            output_config: { effort: "low" },
            ...extra,
          } as never,
          { timeout: timeoutMs }
        )
      );
      return textOf((msg as unknown as { content: { type: string; text?: string }[] }).content);
    } catch (e) {
      throw toRouteError(e);
    }
  },

  async stream(route: Route, req: CompletionRequest, timeoutMs: number): Promise<AsyncIterable<string>> {
    const { system, messages } = toAnthropic(route, req.messages);
    let events: AsyncIterable<{ type: string; delta?: { type: string; text?: string } }>;
    try {
      events = (await withFallbackRetry(route.model, async (extra) =>
        clientFor(route).beta.messages.create(
          {
            model: route.model,
            max_tokens: req.maxTokens + THINKING_HEADROOM.quick,
            ...(system ? { system } : {}),
            messages,
            output_config: { effort: "low" },
            stream: true,
            ...extra,
          } as never,
          { timeout: timeoutMs }
        )
      )) as never;
    } catch (e) {
      throw toRouteError(e);
    }
    return {
      async *[Symbol.asyncIterator]() {
        try {
          for await (const event of events) {
            if (event.type === "content_block_delta" && event.delta?.type === "text_delta" && event.delta.text) yield event.delta.text;
          }
        } catch (e) {
          throw toRouteError(e);
        }
      },
    };
  },

  async turn(route: Route, req: TurnRequest): Promise<TurnOutput> {
    const { system, messages } = toAnthropic(route, req.messages);
    try {
      const final = await withFallbackRetry(route.model, async (extra) => {
        const stream = clientFor(route).beta.messages.stream(
          {
            model: route.model,
            max_tokens: req.maxTokens + THINKING_HEADROOM.agent,
            ...(system ? { system } : {}),
            messages,
            ...(req.tools.length
              ? { tools: req.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters })) }
              : {}),
            output_config: { effort: req.effort ?? "medium" },
            ...extra,
          } as never,
          { timeout: req.timeoutMs ?? 120_000, signal: req.signal }
        );
        stream.on("text", (delta: string) => req.onText?.(delta));
        return stream.finalMessage();
      });
      const content = (final as unknown as { content: Block[] }).content;
      const toolCalls: ToolCall[] = content
        .filter((b) => b.type === "tool_use")
        .map((b) => ({
          id: String(b.id),
          name: String(b.name),
          arguments: b.input && typeof b.input === "object" && !Array.isArray(b.input) ? (b.input as Record<string, unknown>) : {},
        }));
      const usage = (final as unknown as { usage?: { input_tokens?: number; output_tokens?: number } }).usage;
      return {
        text: textOf(content as { type: string; text?: string }[]).trim(),
        toolCalls,
        stop: stopOf((final as unknown as { stop_reason?: string }).stop_reason, toolCalls.length),
        replay: { provider: "anthropic", model: route.model, data: content },
        usage: usage ? { input: usage.input_tokens ?? 0, output: usage.output_tokens ?? 0 } : undefined,
      };
    } catch (e) {
      throw toRouteError(e);
    }
  },
};
