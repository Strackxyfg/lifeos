import { describe, it, expect } from "vitest";
import { createRouter, rankOf, routesFromEnv, tierOf } from "@/lib/ai/router";
import { mergeDetails, openRouterDetails, toChatMessages, turnBody } from "@/lib/ai/providers/chat";
import type { AgentMessage, Route } from "@/lib/ai/types";

/**
 * OpenRouter as the agent's main door: which model each task gets, and the
 * models' reasoning carried from one step to the next.
 */

const env = { GROQ_API_KEY: "g", OPENROUTER_API_KEY: "o" };
const router = createRouter({ routes: routesFromEnv(env), transport: { complete: async () => "", stream: async () => (async function* () {})() } });
const first = (task: Parameters<typeof router.routesFor>[0]) => router.routesFor(task)[0].model;

describe("which model each task gets", () => {
  it("leads the agent with Claude Sonnet, thinks harder with Opus, runs sub-agents on Haiku, searches on the cheapest", () => {
    expect(first("agent")).toBe("anthropic/claude-sonnet-5.5");
    expect(first("agent_deep")).toBe("anthropic/claude-opus-5.5");
    expect(first("research")).toBe("anthropic/claude-haiku-5.5");
    expect(first("search")).toBe("deepseek/deepseek-v4.1-flash");
  });

  it("keeps everyday features on the pool they were measured on", () => {
    expect(router.routesFor("classify")[0].provider).toBe("groq");
    expect(router.routesFor("chat")[0].provider).toBe("groq");
  });

  it("never picks a batch or pro variant by accident", () => {
    expect(rankOf("agent", "anthropic/claude-sonnet-5.5:batch")).toBe(rankOf("agent", "some/unknown-model"));
    expect(rankOf("agent", "openai/gpt-6.1-sol-pro")).toBe(rankOf("agent", "some/unknown-model"));
    expect(rankOf("agent", "openai/gpt-6.1-sol")).toBe(1);
  });

  it("puts Gemini 4 in the frontier tier", () => {
    expect(tierOf("google/gemini-4-argon")).toBe("frontier");
    expect(tierOf("anthropic/claude-haiku-5.5")).toBe("balanced");
  });
});

const or: Route = { id: "openrouter:anthropic/claude-sonnet-5.5", provider: "openrouter", model: "anthropic/claude-sonnet-5.5", baseURL: "", apiKey: "", tier: "frontier", api: "chat" };

describe("reasoning, step to step", () => {
  it("puts streamed blocks back together, in order", () => {
    const blocks: Record<string, unknown>[] = [];
    mergeDetails(blocks, [{ type: "reasoning.text", text: "Let me ", index: 0, format: "anthropic-claude-v1" }]);
    mergeDetails(blocks, [{ type: "reasoning.text", text: "think.", index: 0 }]);
    mergeDetails(blocks, [{ type: "reasoning.text", signature: "sig", index: 0 }]);
    mergeDetails(blocks, [{ type: "reasoning.encrypted", data: "abc", index: 1 }]);
    mergeDetails(blocks, null);
    expect(blocks).toEqual([
      { type: "reasoning.text", text: "Let me think.", index: 0, format: "anthropic-claude-v1", signature: "sig" },
      { type: "reasoning.encrypted", data: "abc", index: 1 },
    ]);
  });

  it("continues the last block of a type when fragments carry no index", () => {
    const blocks: Record<string, unknown>[] = [];
    mergeDetails(blocks, [{ type: "reasoning.summary", summary: "A" }]);
    mergeDetails(blocks, [{ type: "reasoning.summary", summary: "B" }]);
    expect(blocks).toEqual([{ type: "reasoning.summary", summary: "AB" }]);
  });

  it("sends the blocks back only to the model that wrote them", () => {
    const replay = { provider: "openrouter" as const, model: or.model, data: { details: [{ type: "reasoning.text", text: "x" }] } };
    const messages: AgentMessage[] = [
      { role: "user", content: "hi" },
      { role: "assistant", content: "", toolCalls: [{ id: "c1", name: "brain_search", arguments: { query: "x" } }], replay },
      { role: "tool", toolCallId: "c1", name: "brain_search", content: "r" },
    ];
    expect(toChatMessages(or, messages)[1]).toMatchObject({ reasoning_details: replay.data.details });
    const other = { ...or, model: "openai/gpt-6.1-sol" };
    expect(toChatMessages(other, messages)[1]).not.toHaveProperty("reasoning_details");
    expect(openRouterDetails(or, { ...replay, data: { details: [] } })).toBeNull();
  });

  it("reasons on its own steps, and not right after a step another model answered", () => {
    const own: AgentMessage[] = [
      { role: "user", content: "hi" },
      { role: "assistant", content: "", toolCalls: [{ id: "c1", name: "t", arguments: {} }], replay: { provider: "openrouter", model: or.model, data: { details: [] } } },
      { role: "tool", toolCallId: "c1", name: "t", content: "r" },
    ];
    expect(turnBody(or, { task: "agent", messages: own, tools: [], maxTokens: 100, effort: "high" })).toMatchObject({ reasoning: { effort: "high" }, stream_options: { include_usage: true } });
    const foreign: AgentMessage[] = [own[0], { ...(own[1] as Extract<AgentMessage, { role: "assistant" }>), replay: undefined }, own[2]];
    expect(turnBody(or, { task: "agent", messages: foreign, tools: [], maxTokens: 100 })).toMatchObject({ reasoning: { effort: "none" } });
    expect(turnBody(or, { task: "agent", messages: [own[0]], tools: [], maxTokens: 100 })).toMatchObject({ reasoning: { effort: "medium" } });
  });
});
