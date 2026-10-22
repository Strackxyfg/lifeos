import {
  parseArguments,
  type AgentMessage,
  type CompletionRequest,
  type Route,
  type ToolCall,
  type TurnOutput,
  type TurnRequest,
} from "../types";
import { clientFor, toRouteError } from "./chat";

/**
 * OpenAI's current models through the Responses API. Their Chat Completions
 * endpoint answers without tool calling (checked on the model pages,
 * 2026-10-22), so the agent needs this protocol.
 *
 *  - Nothing is kept on OpenAI's side (`store: false`); the reasoning items a
 *    turn produced come back encrypted (`include`) and are sent back as they
 *    are on the next step of the same conversation, to the same model.
 *  - Reasoning models take no `temperature`; depth is `reasoning.effort`, and
 *    the reasoning is counted in `max_output_tokens`.
 */

type Item = Record<string, unknown>;

/** A conversation as Responses input items, for this route, with the instructions apart. */
export function toResponsesInput(route: Route, messages: AgentMessage[]): { instructions: string; input: Item[] } {
  const instructions = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
  const input: Item[] = [];
  for (const m of messages) {
    if (m.role === "system") continue;
    if (m.role === "user") input.push({ role: "user", content: m.content });
    else if (m.role === "tool") input.push({ type: "function_call_output", call_id: m.toolCallId, output: m.isError ? `ERROR: ${m.content}` : m.content });
    else if (m.replay?.provider === "openai" && m.replay.model === route.model && Array.isArray(m.replay.data)) input.push(...(m.replay.data as Item[]));
    else {
      if (m.content.trim()) input.push({ role: "assistant", content: m.content });
      for (const c of m.toolCalls ?? []) input.push({ type: "function_call", call_id: c.id, name: c.name, arguments: c.invalid ?? JSON.stringify(c.arguments) });
    }
  }
  return { instructions, input };
}

interface ResponseLike {
  output?: Item[];
  status?: string;
  incomplete_details?: { reason?: string } | null;
  usage?: { input_tokens?: number; output_tokens?: number };
}

/** What a finished response says: its text, its tool calls, why it stopped. */
export function fromResponse(r: ResponseLike): Omit<TurnOutput, "replay"> & { items: Item[] } {
  const items = r.output ?? [];
  let text = "";
  const toolCalls: ToolCall[] = [];
  for (const item of items) {
    if (item.type === "message" && Array.isArray(item.content)) {
      for (const part of item.content as Item[]) if (part.type === "output_text" && typeof part.text === "string") text += part.text;
    } else if (item.type === "function_call") {
      const { args, invalid } = parseArguments(item.arguments);
      toolCalls.push({ id: String(item.call_id), name: String(item.name), arguments: args, ...(invalid !== undefined ? { invalid } : {}) });
    }
  }
  const reason = r.incomplete_details?.reason;
  const stop: TurnOutput["stop"] =
    reason === "max_output_tokens" ? "max_tokens" : reason === "content_filter" ? "refusal" : toolCalls.length ? "tool_calls" : r.status === "completed" ? "end" : "other";
  return {
    text: text.trim(),
    toolCalls,
    stop,
    items,
    usage: r.usage ? { input: r.usage.input_tokens ?? 0, output: r.usage.output_tokens ?? 0 } : undefined,
  };
}

/** Reasoning counts in the output budget: room for it. */
const HEADROOM = { quick: 1_024, agent: 6_000 };

export const responsesTransport = {
  async complete(route: Route, req: CompletionRequest, timeoutMs: number): Promise<string> {
    const { instructions, input } = toResponsesInput(route, req.messages);
    try {
      const r = await clientFor(route).responses.create(
        {
          model: route.model,
          ...(instructions ? { instructions } : {}),
          input,
          reasoning: { effort: "low" },
          max_output_tokens: req.maxTokens + HEADROOM.quick,
          store: false,
          ...(req.json ? { text: { format: { type: "json_object" } } } : {}),
        } as never,
        { timeout: timeoutMs }
      );
      return fromResponse(r as unknown as ResponseLike).text;
    } catch (e) {
      throw toRouteError(e);
    }
  },

  async stream(route: Route, req: CompletionRequest, timeoutMs: number): Promise<AsyncIterable<string>> {
    const { instructions, input } = toResponsesInput(route, req.messages);
    let events: AsyncIterable<{ type: string; delta?: string }>;
    try {
      events = (await clientFor(route).responses.create(
        {
          model: route.model,
          ...(instructions ? { instructions } : {}),
          input,
          reasoning: { effort: "low" },
          max_output_tokens: req.maxTokens + HEADROOM.quick,
          store: false,
          stream: true,
        } as never,
        { timeout: timeoutMs }
      )) as never;
    } catch (e) {
      throw toRouteError(e);
    }
    return {
      async *[Symbol.asyncIterator]() {
        try {
          for await (const event of events) {
            if (event.type === "response.output_text.delta" && event.delta) yield event.delta;
            if (event.type === "error" || event.type === "response.failed") throw new Error("The response failed.");
          }
        } catch (e) {
          throw toRouteError(e);
        }
      },
    };
  },

  async turn(route: Route, req: TurnRequest): Promise<TurnOutput> {
    const { instructions, input } = toResponsesInput(route, req.messages);
    let final: ResponseLike | null = null;
    try {
      const events = (await clientFor(route).responses.create(
        {
          model: route.model,
          ...(instructions ? { instructions } : {}),
          input,
          ...(req.tools.length
            ? { tools: req.tools.map((t) => ({ type: "function", name: t.name, description: t.description, parameters: t.parameters, strict: false })) }
            : {}),
          reasoning: { effort: req.effort ?? "medium" },
          max_output_tokens: req.maxTokens + HEADROOM.agent,
          store: false,
          include: ["reasoning.encrypted_content"],
          stream: true,
        } as never,
        { timeout: req.timeoutMs ?? 120_000, signal: req.signal }
      )) as unknown as AsyncIterable<{ type: string; delta?: string; response?: ResponseLike }>;
      for await (const event of events) {
        if (event.type === "response.output_text.delta" && event.delta) req.onText?.(event.delta);
        else if ((event.type === "response.completed" || event.type === "response.incomplete") && event.response) final = event.response;
        else if (event.type === "response.failed" || event.type === "error") throw new Error("The response failed.");
      }
    } catch (e) {
      throw toRouteError(e);
    }
    if (!final) throw toRouteError(new Error("The response ended without a result."));
    const { items, ...out } = fromResponse(final);
    return { ...out, replay: { provider: "openai", model: route.model, data: items } };
  },
};

