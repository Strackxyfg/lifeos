import OpenAI from "openai";
import {
  RouteError,
  parseArguments,
  type AgentMessage,
  type CompletionRequest,
  type Effort,
  type Route,
  type ToolCall,
  type TurnOutput,
  type TurnRequest,
} from "../types";

/**
 * Providers that speak the OpenAI Chat Completions protocol: Groq, Mistral,
 * Cerebras, DeepSeek, OpenRouter. One adapter, with what each model family
 * needs written down once:
 *
 *  - Qwen 3 reasons aloud unless told `/no_think`, and even then opens with
 *    an empty `<think></think>` — never shown.
 *  - gpt-oss spends part of `max_tokens` on reasoning it returns separately;
 *    a ceiling sized only for the answer truncates the JSON.
 *  - DeepSeek thinks by default. Quick features turn it off; the agent turns
 *    it up — and then DeepSeek requires each earlier turn's
 *    `reasoning_content` back, or answers 400.
 *  - Mistral accepts only tool-call ids of 9 letters or digits.
 *  - OpenRouter normalises reasoning as `reasoning: {effort}` for every model.
 */

/* ── Model families ───────────────────────────────────────────────── */

export const isQwen3 = (model: string) => /qwen-?3/i.test(model);
export const isGptOss = (model: string) => /gpt-oss/i.test(model);
const isDeepSeek = (route: Route) => route.provider === "deepseek";

/** Reasoning tokens gpt-oss spends at low effort, measured with room to spare. */
export const REASONING_HEADROOM = 400;

/** Body for a plain completion — the shape the measured features were tuned on. */
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
  // Quick features want an answer, not a reasoning trace.
  if (isDeepSeek(route)) body.thinking = { type: "disabled" };
  if (route.provider === "openrouter") body.reasoning = { effort: "low", exclude: true };
  return body;
}

/* ── Tool-call ids ────────────────────────────────────────────────── */

/** A stable 9-character id for Mistral, from whatever id another provider gave. */
export function mistralId(id: string): string {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const alphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let out = "";
  let x = h >>> 0;
  for (let i = 0; i < 9; i++) {
    out += alphabet[x % alphabet.length];
    x = Math.floor(x / alphabet.length) ^ Math.imul(x, 31 + i);
    x >>>= 0;
  }
  return out;
}

const idFor = (route: Route, id: string) => (route.provider === "mistral" && !/^[a-zA-Z0-9]{9}$/.test(id) ? mistralId(id) : id);

/* ── Messages ─────────────────────────────────────────────────────── */

/** A conversation in Chat Completions shape, for this route. */
export function toChatMessages(route: Route, messages: AgentMessage[]): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const m of messages) {
    if (m.role === "system" || m.role === "user") {
      out.push({ role: m.role, content: m.content });
    } else if (m.role === "assistant") {
      const msg: Record<string, unknown> = { role: "assistant", content: m.content || null };
      if (m.toolCalls?.length) {
        msg.tool_calls = m.toolCalls.map((c) => ({
          id: idFor(route, c.id),
          type: "function",
          function: { name: c.name, arguments: c.invalid ?? JSON.stringify(c.arguments) },
        }));
      }
      // DeepSeek wants its own reasoning back on every later turn of a tool conversation.
      if (isDeepSeek(route) && m.replay?.provider === "deepseek" && typeof m.replay.data === "string") msg.reasoning_content = m.replay.data;
      out.push(msg);
    } else {
      out.push({ role: "tool", tool_call_id: idFor(route, m.toolCallId), content: m.isError ? `ERROR: ${m.content}` : m.content });
    }
  }
  return out;
}

const EFFORT: Record<Effort, { oss: string; deepseek: string; openrouter: string }> = {
  low: { oss: "low", deepseek: "low", openrouter: "low" },
  medium: { oss: "medium", deepseek: "high", openrouter: "medium" },
  high: { oss: "high", deepseek: "max", openrouter: "high" },
};

/** Body for one step of a tool-using conversation. */
export function turnBody(route: Route, req: TurnRequest): Record<string, unknown> {
  const effort = req.effort ?? "medium";
  const messages = toChatMessages(route, req.messages);
  if (isQwen3(route.model)) {
    // Thinking aloud mixes with tool calls on Qwen 3: the plan goes in the visible text instead.
    const last = [...messages].reverse().find((m) => m.role === "user" || m.role === "tool");
    if (last && typeof last.content === "string" && !last.content.includes("/no_think")) last.content = `${last.content}\n\n/no_think`;
  }
  const body: Record<string, unknown> = {
    model: route.model,
    messages,
    max_tokens: req.maxTokens + (isGptOss(route.model) ? REASONING_HEADROOM * 3 : 0),
    stream: true,
  };
  if (req.tools.length) {
    body.tools = req.tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } }));
  }
  if (isDeepSeek(route)) {
    // With tools, DeepSeek wants the reasoning of every earlier answer back. An answer it did not write (another model,
    // an earlier request) has none to send: think only when every earlier answer can be replayed.
    const foreign = req.messages.some((m) => m.role === "assistant" && m.replay?.provider !== "deepseek");
    body.thinking = { type: foreign ? "disabled" : "enabled" };
    if (!foreign) body.reasoning_effort = EFFORT[effort].deepseek;
    else body.temperature = 0.3;
  } else if (isGptOss(route.model)) {
    body.reasoning_effort = EFFORT[effort].oss;
  } else if (route.provider === "openrouter") {
    body.reasoning = { effort: EFFORT[effort].openrouter, exclude: true };
  } else {
    body.temperature = 0.3;
  }
  return body;
}

/* ── Text that is not for the reader ──────────────────────────────── */

/**
 * Drops a leading `<think>…</think>` from streamed text, wherever the chunks
 * cut it. Text after it — or text that never had one — passes through.
 */
export function thinkFilter(): (chunk: string) => string {
  let state: "start" | "inside" | "pass" = "start";
  let buffer = "";
  return (chunk) => {
    if (state === "pass") return chunk;
    buffer += chunk;
    if (state === "start") {
      const trimmed = buffer.trimStart();
      if (trimmed.length < 7 && "<think>".startsWith(trimmed)) return "";
      if (!trimmed.startsWith("<think>")) {
        state = "pass";
        const out = buffer;
        buffer = "";
        return out;
      }
      state = "inside";
    }
    const end = buffer.indexOf("</think>");
    if (end < 0) return "";
    state = "pass";
    const out = buffer.slice(end + "</think>".length).replace(/^\s+/, "");
    buffer = "";
    return out;
  };
}

/* ── The transport ────────────────────────────────────────────────── */

const clients = new Map<string, OpenAI>();
export function clientFor(route: Pick<Route, "baseURL" | "apiKey"> & { provider?: Route["provider"] }): OpenAI {
  const key = `${route.baseURL}|${route.apiKey.slice(-6)}`;
  let c = clients.get(key);
  if (!c) {
    // No SDK retries: a retry waits out the provider's retry-after — up to a
    // minute of spinner — when the next route could answer at once.
    c = new OpenAI({
      apiKey: route.apiKey,
      baseURL: route.baseURL,
      maxRetries: 0,
      defaultHeaders: route.provider === "openrouter" ? { "X-Title": "LifeOS" } : undefined,
    });
    clients.set(key, c);
  }
  return c;
}

/** "try again in 1m26.4s", "in 7.66s", "in 2h3m" → milliseconds. */
export function parseRetryAfter(text: string): number | undefined {
  const m = /try again in\s+((?:\d+h)?(?:\d+m(?!s))?(?:[\d.]+s)?(?:[\d.]+ms)?)/i.exec(text);
  if (!m || !m[1]) return undefined;
  const part = (re: RegExp) => Number.parseFloat(re.exec(m[1])?.[1] ?? "0");
  const ms = part(/(\d+)h/) * 3_600_000 + part(/(\d+)m(?!s)/) * 60_000 + part(/([\d.]+)s/) * 1000 + part(/([\d.]+)ms/);
  return ms > 0 ? Math.ceil(ms) : undefined;
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

const stopOf = (finish: string | null, calls: number): TurnOutput["stop"] =>
  calls > 0 ? "tool_calls" : finish === "length" ? "max_tokens" : finish === "content_filter" ? "refusal" : finish === "stop" || finish === null ? "end" : "other";

export const chatTransport = {
  async complete(route: Route, req: CompletionRequest, timeoutMs: number): Promise<string> {
    try {
      const r = (await clientFor(route).chat.completions.create(bodyFor(route, req, false) as never, { timeout: timeoutMs })) as OpenAI.Chat.Completions.ChatCompletion;
      return r.choices[0]?.message?.content ?? "";
    } catch (e) {
      throw toRouteError(e);
    }
  },

  async stream(route: Route, req: CompletionRequest, timeoutMs: number): Promise<AsyncIterable<string>> {
    let raw: AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>;
    try {
      raw = (await clientFor(route).chat.completions.create(bodyFor(route, req, true) as never, { timeout: timeoutMs })) as never;
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

  async turn(route: Route, req: TurnRequest): Promise<TurnOutput> {
    const visible = thinkFilter();
    let text = "";
    let reasoning = "";
    let finish: string | null = null;
    const slots: { id: string; name: string; args: string }[] = [];
    try {
      const stream = (await clientFor(route).chat.completions.create(turnBody(route, req) as never, {
        timeout: req.timeoutMs ?? 90_000,
        signal: req.signal,
      })) as unknown as AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>;
      for await (const chunk of stream) {
        const choice = chunk.choices[0];
        if (!choice) continue;
        const d = choice.delta as OpenAI.Chat.Completions.ChatCompletionChunk.Choice.Delta & { reasoning_content?: string | null };
        if (d.content) {
          const shown = visible(d.content);
          if (shown) {
            text += shown;
            req.onText?.(shown);
          }
        }
        if (d.reasoning_content) reasoning += d.reasoning_content;
        for (const tc of d.tool_calls ?? []) {
          const slot = (slots[tc.index] ??= { id: "", name: "", args: "" });
          if (tc.id) slot.id = tc.id;
          if (tc.function?.name) slot.name += tc.function.name;
          if (tc.function?.arguments) slot.args += tc.function.arguments;
        }
        if (choice.finish_reason) finish = choice.finish_reason;
      }
    } catch (e) {
      throw toRouteError(e);
    }
    const toolCalls: ToolCall[] = slots
      .filter((s) => s && s.name)
      .map((s, i) => {
        const { args, invalid } = parseArguments(s.args);
        return { id: s.id || `call_${i}_${Date.now().toString(36)}`, name: s.name, arguments: args, ...(invalid !== undefined ? { invalid } : {}) };
      });
    return {
      text: text.trim(),
      toolCalls,
      stop: stopOf(finish, toolCalls.length),
      replay: isDeepSeek(route) && reasoning ? { provider: route.provider, model: route.model, data: reasoning } : undefined,
    };
  },
};
