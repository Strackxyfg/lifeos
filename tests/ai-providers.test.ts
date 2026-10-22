import { describe, expect, it } from "vitest";
import { AIError, createRouter, routesFromEnv, tierOf, PROVIDERS } from "@/lib/ai/router";
import { RouteError, parseArguments, type AgentMessage, type Route, type Transport, type TurnOutput } from "@/lib/ai/types";
import { mistralId, thinkFilter, toChatMessages, turnBody } from "@/lib/ai/providers/chat";
import { anthropicId, toAnthropic } from "@/lib/ai/providers/anthropic";
import { fromResponse, toResponsesInput } from "@/lib/ai/providers/responses";

/**
 * The frontier tier and tool calling, without a network: tiers, routing,
 * failover of a tool-using turn, and the exact shape each protocol is given
 * — what a conversation becomes for Chat Completions, Anthropic Messages and
 * OpenAI Responses, and what comes back.
 */

const route = (provider: Route["provider"], model: string): Route => ({
  id: `${provider}:${model}`,
  provider,
  model,
  baseURL: PROVIDERS[provider].baseURL,
  apiKey: "k",
  tier: tierOf(model),
  api: PROVIDERS[provider].api,
});

const conversation: AgentMessage[] = [
  { role: "system", content: "You are the agent." },
  { role: "user", content: "Find my notes on the podcast." },
  { role: "assistant", content: "Let me look.", toolCalls: [{ id: "call_abc.123", name: "brain_search", arguments: { query: "podcast" } }] },
  { role: "tool", toolCallId: "call_abc.123", name: "brain_search", content: "n1 Podcast idea" },
  { role: "assistant", content: "Found one." },
];

describe("tiers", () => {
  it("puts the strongest reasoning models in the frontier tier", () => {
    for (const m of ["claude-opus-5-5", "claude-sonnet-5-5", "claude-fable-5-1", "gpt-6.1-sol", "gpt-6-astra", "deepseek-v4-pro", "moonshotai/kimi-k3", "deepseek/deepseek-v4-pro"]) {
      expect(tierOf(m), m).toBe("frontier");
    }
    for (const m of ["deepseek-flash", "z-ai/glm-5.3", "mistral-medium-latest", "openai/gpt-oss-120b"]) expect(tierOf(m), m).toBe("strong");
    for (const m of ["claude-haiku-5-5", "gpt-6-luna", "qwen/qwen3.8-27b", "mistral-small-latest"]) expect(tierOf(m), m).toBe("balanced");
    expect(tierOf("openai/gpt-oss-20b")).toBe("fast");
  });

  it("builds routes for every provider with its protocol", () => {
    const r = routesFromEnv({ GROQ_API_KEY: "g", ANTHROPIC_API_KEY: "a", OPENAI_API_KEY: "o", DEEPSEEK_API_KEY: "d", OPENROUTER_API_KEY: "r" });
    const api = Object.fromEntries(r.map((x) => [x.provider, x.api]));
    expect(api).toEqual({ groq: "chat", deepseek: "chat", openrouter: "chat", anthropic: "anthropic", openai: "responses" });
    expect(r.filter((x) => x.provider === "anthropic").map((x) => x.model)).toEqual(["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"]);
  });
});

describe("routing", () => {
  const routes = routesFromEnv({ GROQ_API_KEY: "g", ANTHROPIC_API_KEY: "a", DEEPSEEK_API_KEY: "d" });
  const router = createRouter({ routes, transport: { complete: async () => "", stream: async () => (async function* () {})() } });

  it("gives the agent the frontier first, from any provider", () => {
    const order = router.routesFor("agent").map((r) => r.id);
    expect(order.slice(0, 3)).toEqual(["deepseek:deepseek-v4-pro", "anthropic:claude-opus-5-5", "anthropic:claude-sonnet-5-5"]);
    expect(order.indexOf("groq:openai/gpt-oss-120b")).toBeLessThan(order.indexOf("groq:qwen/qwen3.8-27b"));
  });

  it("keeps everyday features on the preferred provider's pool, frontier last", () => {
    const order = router.routesFor("classify").map((r) => r.id);
    expect(order.slice(0, 3)).toEqual(["groq:qwen/qwen3.8-27b", "groq:openai/gpt-oss-20b", "groq:openai/gpt-oss-120b"]);
    expect(order.at(-1)).toMatch(/^(anthropic|deepseek):/);
  });

  it("lets a caller ask for other tiers", () => {
    expect(router.routesFor("chat", ["frontier"])[0].tier).toBe("frontier");
  });
});

describe("a tool-using turn", () => {
  const routes = routesFromEnv({ GROQ_API_KEY: "g", ANTHROPIC_API_KEY: "a" });
  const answer: TurnOutput = { text: "ok", toolCalls: [], stop: "end" };

  function transport(script: Record<string, "fail-before" | "fail-after" | "ok">) {
    const tried: string[] = [];
    const t: Transport = {
      complete: async () => "",
      stream: async () => (async function* () {})(),
      async turn(r, req) {
        tried.push(r.id);
        const what = script[r.id] ?? "ok";
        if (what === "fail-before") throw new RouteError("overloaded", 529);
        if (what === "fail-after") {
          req.onText?.("Partial");
          throw new RouteError("cut", 500);
        }
        req.onText?.("ok");
        return answer;
      },
    };
    return { t, tried };
  }

  it("fails over before the first word", async () => {
    const { t, tried } = transport({ "anthropic:claude-opus-5-5": "fail-before" });
    const out = await createRouter({ routes, transport: t }).turn({ task: "agent", messages: [], tools: [], maxTokens: 100, onText: () => {} });
    expect(out.route.id).toBe("anthropic:claude-sonnet-5-5");
    expect(tried).toEqual(["anthropic:claude-opus-5-5", "anthropic:claude-sonnet-5-5"]);
  });

  it("never fails over once the person is reading", async () => {
    const { t } = transport({ "anthropic:claude-opus-5-5": "fail-after" });
    await expect(createRouter({ routes, transport: t }).turn({ task: "agent", messages: [], tools: [], maxTokens: 100, onText: () => {} })).rejects.toBeInstanceOf(AIError);
  });

  it("goes back to the model that began the conversation", async () => {
    const { t, tried } = transport({});
    await createRouter({ routes, transport: t }).turn({ task: "agent", messages: [], tools: [], maxTokens: 100, stickTo: "groq:openai/gpt-oss-120b" });
    expect(tried[0]).toBe("groq:openai/gpt-oss-120b");
  });
});

describe("Chat Completions", () => {
  it("sends tool calls and results, with ids Mistral accepts", () => {
    const groq = toChatMessages(route("groq", "openai/gpt-oss-120b"), conversation);
    expect(groq[2]).toMatchObject({ role: "assistant", tool_calls: [{ id: "call_abc.123", type: "function", function: { name: "brain_search", arguments: '{"query":"podcast"}' } }] });
    expect(groq[3]).toMatchObject({ role: "tool", tool_call_id: "call_abc.123" });
    const mistral = toChatMessages(route("mistral", "mistral-medium-latest"), conversation);
    const id = (mistral[2].tool_calls as { id: string }[])[0].id;
    expect(id).toMatch(/^[a-zA-Z0-9]{9}$/);
    expect(mistral[3].tool_call_id).toBe(id);
    expect(mistralId("a")).not.toBe(mistralId("b"));
    expect(mistralId("a")).toBe(mistralId("a"));
  });

  it("gives DeepSeek its own reasoning back, and thinks only when every answer can be replayed", () => {
    const ds = route("deepseek", "deepseek-v4-pro");
    const own: AgentMessage[] = [
      { role: "user", content: "x" },
      { role: "assistant", content: "", toolCalls: [{ id: "c1", name: "t", arguments: {} }], replay: { provider: "deepseek", model: "deepseek-v4-pro", data: "I should search." } },
      { role: "tool", toolCallId: "c1", name: "t", content: "r" },
    ];
    expect(toChatMessages(ds, own)[1].reasoning_content).toBe("I should search.");
    expect(turnBody(ds, { task: "agent", messages: own, tools: [], maxTokens: 10, effort: "high" })).toMatchObject({ thinking: { type: "enabled" }, reasoning_effort: "max" });
    expect(turnBody(ds, { task: "agent", messages: conversation, tools: [], maxTokens: 10 })).toMatchObject({ thinking: { type: "disabled" } });
  });

  it("sets reasoning per family and tells Qwen not to think aloud", () => {
    const tools = [{ name: "brain_search", description: "Search", parameters: { type: "object" as const, properties: {} } }];
    const oss = turnBody(route("groq", "openai/gpt-oss-120b"), { task: "agent", messages: conversation, tools, maxTokens: 100, effort: "medium" });
    expect(oss).toMatchObject({ reasoning_effort: "medium", tools: [{ type: "function", function: { name: "brain_search" } }] });
    const qwen = turnBody(route("groq", "qwen/qwen3.8-27b"), { task: "agent", messages: conversation, tools, maxTokens: 100 });
    const msgs = qwen.messages as { role: string; content: string }[];
    expect(msgs.filter((m) => m.content?.includes?.("/no_think"))).toHaveLength(1);
    expect(msgs[3].content).toContain("/no_think");
  });

  it("drops a leading <think> block wherever the stream cuts it", () => {
    const f = thinkFilter();
    expect(["<th", "ink>\nhmm", "</thi", "nk>\n\nHello", " world"].map(f).join("")).toBe("Hello world");
    const g = thinkFilter();
    expect(["Hel", "lo"].map(g).join("")).toBe("Hello");
  });
});

describe("Anthropic Messages", () => {
  it("puts the system apart, groups tool results, and keeps ids Claude accepts", () => {
    const { system, messages } = toAnthropic(route("anthropic", "claude-opus-5-5"), [
      ...conversation.slice(0, 3),
      { role: "tool", toolCallId: "call_abc.123", name: "brain_search", content: "n1", isError: false },
      { role: "tool", toolCallId: "call_2", name: "brain_read", content: "boom", isError: true },
    ]);
    expect(system).toBe("You are the agent.");
    expect(messages[1]).toEqual({
      role: "assistant",
      content: [
        { type: "text", text: "Let me look." },
        { type: "tool_use", id: "call_abc_123", name: "brain_search", input: { query: "podcast" } },
      ],
    });
    expect(messages[2]).toEqual({
      role: "user",
      content: [
        { type: "tool_result", tool_use_id: "call_abc_123", content: "n1" },
        { type: "tool_result", tool_use_id: "call_2", content: "boom", is_error: true },
      ],
    });
    expect(anthropicId("a.b/c")).toBe("a_b_c");
  });

  it("sends the same model's own turn back unchanged — thinking blocks too — and nobody else's", () => {
    const blocks = [{ type: "thinking", thinking: "", signature: "sig" }, { type: "tool_use", id: "toolu_1", name: "t", input: {} }];
    const msgs: AgentMessage[] = [{ role: "user", content: "x" }, { role: "assistant", content: "", replay: { provider: "anthropic", model: "claude-opus-5-5", data: blocks } }];
    expect(toAnthropic(route("anthropic", "claude-opus-5-5"), msgs).messages[1].content).toBe(blocks);
    expect(toAnthropic(route("anthropic", "claude-sonnet-5-5"), msgs).messages).toHaveLength(1);
  });

  it("always opens with the person", () => {
    expect(toAnthropic(route("anthropic", "claude-opus-5-5"), [{ role: "assistant", content: "Hi" }]).messages[0].role).toBe("user");
  });
});

describe("OpenAI Responses", () => {
  it("turns tool calls and results into items, instructions apart", () => {
    const { instructions, input } = toResponsesInput(route("openai", "gpt-6.1-sol"), conversation);
    expect(instructions).toBe("You are the agent.");
    expect(input).toContainEqual({ type: "function_call", call_id: "call_abc.123", name: "brain_search", arguments: '{"query":"podcast"}' });
    expect(input).toContainEqual({ type: "function_call_output", call_id: "call_abc.123", output: "n1 Podcast idea" });
  });

  it("reads text, tool calls and why it stopped — a call with broken arguments is flagged, not run", () => {
    const out = fromResponse({
      status: "completed",
      output: [
        { type: "reasoning", encrypted_content: "x" },
        { type: "message", content: [{ type: "output_text", text: "Searching." }] },
        { type: "function_call", call_id: "c1", name: "brain_search", arguments: '{"query":"a"}' },
        { type: "function_call", call_id: "c2", name: "brain_read", arguments: "{oops" },
      ],
    });
    expect(out.text).toBe("Searching.");
    expect(out.stop).toBe("tool_calls");
    expect(out.toolCalls[0]).toEqual({ id: "c1", name: "brain_search", arguments: { query: "a" } });
    expect(out.toolCalls[1].invalid).toBe("{oops");
    expect(fromResponse({ status: "incomplete", incomplete_details: { reason: "max_output_tokens" }, output: [] }).stop).toBe("max_tokens");
  });
});

describe("arguments", () => {
  it("are an object, or flagged", () => {
    expect(parseArguments('{"a":1}')).toEqual({ args: { a: 1 } });
    expect(parseArguments({ a: 1 })).toEqual({ args: { a: 1 } });
    expect(parseArguments("")).toEqual({ args: {} });
    expect(parseArguments("[1]").invalid).toBe("[1]");
    expect(parseArguments("{").invalid).toBe("{");
  });
});
