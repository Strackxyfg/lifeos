/**
 * The vocabulary every part of the AI layer shares — the router, the
 * provider adapters (`lib/ai/providers/`) and the agent. Nothing here talks
 * to a network.
 */

export type Provider = "groq" | "cerebras" | "mistral" | "deepseek" | "openrouter" | "anthropic" | "openai";

/**
 * How good a model is at hard work, as LifeOS uses it.
 *  - frontier: the strongest reasoning and agent models (Claude Opus/Sonnet,
 *    GPT-6 Sol/Astra, DeepSeek V4 Pro, Kimi K3…). Plans, multi-step tool use.
 *  - strong / balanced / fast: the pool everyday features run on.
 */
export type Tier = "frontier" | "strong" | "balanced" | "fast";

/** The wire protocol a provider speaks. */
export type Api = "chat" | "anthropic" | "responses";

export type AITask =
  | "chat"
  | "classify"
  | "concepts"
  | "judge"
  | "steps"
  | "insight"
  | "atomize"
  | "decide"
  | "portrait"
  | "maps"
  /** The agent: plans, calls tools, checks its work. */
  | "agent";

/** How hard a reasoning model should think. Mapped per provider. */
export type Effort = "low" | "medium" | "high";

export interface Route {
  /** "provider:model" — unique. */
  id: string;
  provider: Provider;
  model: string;
  baseURL: string;
  apiKey: string;
  tier: Tier;
  api: Api;
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
  /** Tiers to try, best first, instead of the task's own order (an edition may ask for more, or less). */
  prefer?: Tier[];
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

/* ── Tool use ─────────────────────────────────────────────────────── */

/** A JSON Schema object for a tool's arguments. */
export interface ToolSchema {
  type: "object";
  properties: Record<string, Record<string, unknown>>;
  required?: string[];
  additionalProperties?: boolean;
}

export interface ToolSpec {
  /** `[a-zA-Z0-9_-]{1,64}` — what every provider accepts. */
  name: string;
  description: string;
  parameters: ToolSchema;
}

export interface ToolCall {
  id: string;
  name: string;
  /** Parsed arguments; `{}` when the model sent nothing usable (see `invalid`). */
  arguments: Record<string, unknown>;
  /** The raw argument text when it was not valid JSON — the call is answered with an error, never run. */
  invalid?: string;
}

/**
 * What a provider needs back, unchanged, on the next request of the same
 * conversation: Claude's thinking blocks, DeepSeek's reasoning, OpenAI's
 * reasoning items. Only ever sent back to the provider and model that wrote
 * it; another one gets the plain text and tool calls instead.
 */
export interface Replay {
  provider: Provider;
  model: string;
  data: unknown;
}

export type AgentMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; toolCalls?: ToolCall[]; replay?: Replay }
  | { role: "tool"; toolCallId: string; name: string; content: string; isError?: boolean };

export interface TurnRequest {
  task: AITask;
  messages: AgentMessage[];
  tools: ToolSpec[];
  /** Tokens for what the model writes (its thinking headroom is added per provider). */
  maxTokens: number;
  effort?: Effort;
  timeoutMs?: number;
  prefer?: Tier[];
  /** Try this route first — the one that started the conversation, so its replay stays valid. */
  stickTo?: string;
  /** Each piece of visible text as it is written. Failover only happens before the first one. */
  onText?: (delta: string) => void;
  signal?: AbortSignal;
}

export type StopReason = "end" | "tool_calls" | "max_tokens" | "refusal" | "other";

export interface TurnOutput {
  text: string;
  toolCalls: ToolCall[];
  replay?: Replay;
  stop: StopReason;
  usage?: { input: number; output: number };
}

export interface TurnResult extends TurnOutput {
  route: Route;
}

/** How requests actually reach a provider. Swapped for a fake in tests. */
export interface Transport {
  complete(route: Route, req: CompletionRequest, timeoutMs: number): Promise<string>;
  /** Resolves once the stream is open; tokens then come through the iterable. */
  stream(route: Route, req: CompletionRequest, timeoutMs: number): Promise<AsyncIterable<string>>;
  /** One step of a tool-using conversation. */
  turn?(route: Route, req: TurnRequest): Promise<TurnOutput>;
}

/** Tool names every provider accepts. */
export const TOOL_NAME = /^[a-zA-Z0-9_-]{1,64}$/;

/** Arguments as the model wrote them: an object, or the reason they are not one. */
export function parseArguments(raw: unknown): { args: Record<string, unknown>; invalid?: string } {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) return { args: raw as Record<string, unknown> };
  if (typeof raw !== "string" || !raw.trim()) return { args: {} };
  try {
    const v = JSON.parse(raw) as unknown;
    if (v && typeof v === "object" && !Array.isArray(v)) return { args: v as Record<string, unknown> };
    return { args: {}, invalid: raw.slice(0, 2000) };
  } catch {
    return { args: {}, invalid: raw.slice(0, 2000) };
  }
}
