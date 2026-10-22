import type { AgentMessage, Effort, ToolCall, TurnRequest, TurnResult } from "@/lib/ai/types";
import type { RiskTier } from "./capabilities";
import type { Decision } from "./policy";
import { INJECTION_NOTE, checkArgs, clipResult, looksLikeInjection, tierOfTool, type AgentTool, type Source } from "./tools";

/**
 * The agent's loop: think, call tools, read what they return, again — until
 * it has an answer, needs the owner's word, or reaches its step limit.
 *
 * Nothing here talks to a network or a database: the model, the policy, the
 * executor and the journal are handed in, so the whole loop — approvals,
 * refusals, bad arguments, limits, failures — is tested with a scripted model.
 *
 * Every call the model makes is answered before the next model turn (the
 * protocols require it): run, refused with the reason, or declined by the
 * owner. A call that needs the owner's approval pauses the loop; the
 * conversation then holds an assistant turn whose calls are partly
 * answered, and `resume` picks it up from the first unanswered one.
 */

export type StepState = "running" | "done" | "error" | "denied" | "declined";
export type StopKind = "end" | "approval" | "limit" | "max_tokens" | "refusal" | "error";
export type LoopErrorCode = "unavailable" | "rate_limited" | "failed" | "stale" | "aborted";

export type AgentEvent =
  | { t: "model"; route: string; provider: string; model: string }
  | { t: "text"; d: string }
  | {
      t: "step";
      id: string;
      name: string;
      args: Record<string, unknown>;
      state: StepState;
      summary?: string;
      sources?: Source[];
      /** The result holds instructions addressed to an AI — not followed, and the owner is told. */
      flagged?: boolean;
    }
  | { t: "approval"; id: string; name: string; capability: string; tier: RiskTier; args: Record<string, unknown>; reason: string }
  | { t: "transcript"; messages: AgentMessage[] }
  | { t: "end"; stop: StopKind; steps: number }
  | { t: "error"; code: LoopErrorCode };

export interface Outcome {
  ok: boolean;
  /** What the model reads. */
  content: string;
  /** One line for the person. */
  summary: string;
  sources?: Source[];
}

export interface JournalEntry {
  capability: string;
  decision: "allow" | "deny";
  reason: string;
  payload: Record<string, unknown>;
  /** Set when the owner approved this very call. */
  approvedByOwner?: boolean;
}

export interface LoopDeps {
  system: string;
  tools: AgentTool[];
  turn(req: TurnRequest): Promise<TurnResult>;
  decide(capability: string): Decision;
  execute(tool: AgentTool, args: Record<string, unknown>): Promise<Outcome>;
  journal(entry: JournalEntry): Promise<void>;
  emit(e: AgentEvent): void;
  /** Model turns this request may take. */
  maxSteps: number;
  maxTokens?: number;
  effort?: Effort;
  signal?: AbortSignal;
  /** The route the conversation began on, so its reasoning can be sent back to it. */
  stickTo?: string;
}

export interface LoopResult {
  messages: AgentMessage[];
  stop: StopKind;
  steps: number;
  route?: string;
}

/** Said to the model on its last allowed turn; never stored in the conversation. */
export const LIMIT_NUDGE =
  "[LifeOS] This is your last step for this request: do not call any tool. Answer now with what you have — say what is done, and what is left.";

export const DECLINED = "The owner declined this action. Do not try it again; ask them what they would prefer, or carry on without it.";
const NOT_RUN_LIMIT = "Not run: the step limit for this request was reached.";

/* ── The conversation sent to the model ───────────────────────────── */

const REPLAY_MAX = 20_000;
const EARLIER_MAX = 16;

/**
 * What the model is sent. The current request goes whole; earlier ones keep
 * only what was said — the person's words and the agent's final answers —
 * not the intermediate tool calls and results, which would grow the prompt
 * with every exchange for little use. Large reasoning payloads of earlier
 * answers are dropped too.
 */
export function condense(messages: AgentMessage[]): AgentMessage[] {
  let lastUser = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user") {
      lastUser = i;
      break;
    }
  }
  if (lastUser <= 0) return messages.filter((m) => m.role !== "system");
  const earlier: AgentMessage[] = [];
  for (const m of messages.slice(0, lastUser)) {
    if (m.role === "user") earlier.push(m);
    else if (m.role === "assistant" && !m.toolCalls?.length && m.content.trim()) {
      const big = m.replay && JSON.stringify(m.replay.data ?? null).length > REPLAY_MAX;
      earlier.push(big ? { role: "assistant", content: m.content } : m);
    }
  }
  // A conversation opens with the person, whatever was trimmed before it.
  let kept = earlier.slice(-EARLIER_MAX);
  while (kept.length && kept[0].role !== "user") kept = kept.slice(1);
  return [...kept, ...messages.slice(lastUser)];
}

/* ── Calls ────────────────────────────────────────────────────────── */

const toolMessage = (call: ToolCall, content: string, isError = false): AgentMessage => ({
  role: "tool",
  toolCallId: call.id,
  name: call.name,
  content: clipResult(content),
  ...(isError ? { isError: true } : {}),
});

/**
 * Answers calls in order. Returns the index of the call that needs the
 * owner's approval (the loop pauses there), or -1 when every call was answered.
 */
async function answer(calls: ToolCall[], messages: AgentMessage[], deps: LoopDeps): Promise<number> {
  const byName = new Map(deps.tools.map((t) => [t.spec.name, t]));
  for (let i = 0; i < calls.length; i++) {
    const call = calls[i];
    const tool = byName.get(call.name);
    if (!tool) {
      messages.push(toolMessage(call, `Unknown tool "${call.name}". Use only the tools you were given.`, true));
      deps.emit({ t: "step", id: call.id, name: call.name, args: {}, state: "error", summary: "unknown tool" });
      continue;
    }
    if (call.invalid !== undefined) {
      messages.push(toolMessage(call, "The arguments were not valid JSON. Call the tool again with a JSON object.", true));
      deps.emit({ t: "step", id: call.id, name: call.name, args: {}, state: "error", summary: "invalid arguments" });
      continue;
    }
    const checked = checkArgs(tool.spec.parameters, call.arguments);
    if (!checked.ok) {
      messages.push(toolMessage(call, checked.error, true));
      deps.emit({ t: "step", id: call.id, name: call.name, args: call.arguments, state: "error", summary: checked.error });
      continue;
    }
    const decision = deps.decide(tool.capability);
    if (decision.action === "deny") {
      messages.push(toolMessage(call, `Refused: ${decision.reason}`, true));
      await deps.journal({ capability: tool.capability, decision: "deny", reason: decision.reason, payload: checked.args });
      deps.emit({ t: "step", id: call.id, name: call.name, args: checked.args, state: "denied", summary: decision.reason });
      continue;
    }
    if (decision.action === "approve") {
      deps.emit({
        t: "approval",
        id: call.id,
        name: call.name,
        capability: tool.capability,
        tier: tierOfTool(tool),
        args: checked.args,
        reason: decision.reason,
      });
      return i;
    }
    await run(call, tool, checked.args, messages, deps, false);
  }
  return -1;
}

async function run(call: ToolCall, tool: AgentTool, args: Record<string, unknown>, messages: AgentMessage[], deps: LoopDeps, approved: boolean) {
  deps.emit({ t: "step", id: call.id, name: call.name, args, state: "running" });
  let out: Outcome;
  try {
    out = await deps.execute(tool, args);
  } catch (e) {
    out = { ok: false, content: e instanceof Error ? e.message : "The tool failed.", summary: "failed" };
  }
  const text = out.ok ? out.content || out.summary : `Failed: ${out.content || out.summary}`;
  const flagged = out.ok && looksLikeInjection(text);
  messages.push(toolMessage(call, flagged ? `${INJECTION_NOTE}\n\n${text}` : text, !out.ok));
  await deps.journal({
    capability: tool.capability,
    decision: out.ok ? "allow" : "deny",
    reason: out.ok ? out.summary : `Failed: ${out.summary}`,
    payload: args,
    ...(approved ? { approvedByOwner: true } : {}),
  });
  deps.emit({
    t: "step",
    id: call.id,
    name: call.name,
    args,
    state: out.ok ? "done" : "error",
    summary: out.summary,
    sources: out.sources,
    ...(flagged ? { flagged: true } : {}),
  });
}

/* ── The loop ─────────────────────────────────────────────────────── */

function errorCode(e: unknown): LoopErrorCode {
  // The router's AIError codes.
  const code = (e as { code?: unknown })?.code;
  if (code === "unavailable") return "unavailable";
  if (code === "rate_limit") return "rate_limited";
  return "failed";
}

async function loop(messages: AgentMessage[], deps: LoopDeps, steps0 = 0): Promise<LoopResult> {
  const specs = deps.tools.map((t) => t.spec);
  let route = deps.stickTo;
  let steps = steps0;
  while (true) {
    if (deps.signal?.aborted) {
      deps.emit({ t: "error", code: "aborted" });
      return { messages, stop: "error", steps, route };
    }
    const last = steps >= deps.maxSteps - 1;
    const convo = condense(messages);
    let out: TurnResult;
    try {
      out = await deps.turn({
        task: "agent",
        messages: [{ role: "system", content: deps.system }, ...convo, ...(last ? [{ role: "user" as const, content: LIMIT_NUDGE }] : [])],
        tools: specs,
        maxTokens: deps.maxTokens ?? 4_000,
        effort: deps.effort ?? "medium",
        stickTo: route,
        onText: (d) => deps.emit({ t: "text", d }),
        signal: deps.signal,
      });
    } catch (e) {
      deps.emit({ t: "error", code: deps.signal?.aborted ? "aborted" : errorCode(e) });
      return { messages, stop: "error", steps, route };
    }
    steps++;
    route = out.route.id;
    deps.emit({ t: "model", route: out.route.id, provider: out.route.provider, model: out.route.model });
    messages.push({
      role: "assistant",
      content: out.text,
      ...(out.toolCalls.length ? { toolCalls: out.toolCalls } : {}),
      ...(out.replay ? { replay: out.replay } : {}),
    });

    if (!out.toolCalls.length) {
      const stop: StopKind = out.stop === "max_tokens" ? "max_tokens" : out.stop === "refusal" ? "refusal" : "end";
      return { messages, stop, steps, route };
    }
    if (last) {
      // Asked to stop, it called tools anyway: answer them, run none.
      for (const call of out.toolCalls) messages.push(toolMessage(call, NOT_RUN_LIMIT, true));
      return { messages, stop: "limit", steps, route };
    }
    const paused = await answer(out.toolCalls, messages, deps);
    if (paused >= 0) return { messages, stop: "approval", steps, route };
  }
}

/** A new request: the person's message is the last one of `messages`. */
export function start(messages: AgentMessage[], deps: LoopDeps): Promise<LoopResult> {
  return loop([...messages], deps);
}

/** The calls of the last assistant turn not answered yet, in order. */
export function pendingCalls(messages: AgentMessage[]): ToolCall[] {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === "user") return [];
    if (m.role === "assistant") {
      const answered = new Set(messages.slice(i + 1).flatMap((x) => (x.role === "tool" ? [x.toolCallId] : [])));
      return (m.toolCalls ?? []).filter((c) => !answered.has(c.id));
    }
  }
  return [];
}

/**
 * The owner's word on the call the loop paused at — then the calls after it,
 * then the loop. A decision about anything but the first unanswered call is
 * stale (decided twice, or in another tab) and changes nothing.
 */
export async function resume(messages: AgentMessage[], decision: { id: string; approve: boolean }, deps: LoopDeps): Promise<LoopResult> {
  const convo = [...messages];
  const pending = pendingCalls(convo);
  if (!pending.length || pending[0].id !== decision.id) {
    deps.emit({ t: "error", code: "stale" });
    return { messages: convo, stop: "error", steps: 0, route: deps.stickTo };
  }
  const [call, ...rest] = pending;
  const tool = deps.tools.find((t) => t.spec.name === call.name);
  const checked = tool ? checkArgs(tool.spec.parameters, call.arguments) : null;

  if (!tool || !checked?.ok) {
    convo.push(toolMessage(call, tool ? (checked as { error: string }).error : `Unknown tool "${call.name}".`, true));
    deps.emit({ t: "step", id: call.id, name: call.name, args: call.arguments, state: "error" });
  } else if (!decision.approve) {
    convo.push(toolMessage(call, DECLINED, true));
    await deps.journal({ capability: tool.capability, decision: "deny", reason: "Declined by the owner.", payload: checked.args });
    deps.emit({ t: "step", id: call.id, name: call.name, args: checked.args, state: "declined" });
  } else {
    // Approval is the owner's word on this call, not a pass around the
    // rules: decided again now — the kill switch, a forbidden action, an
    // edition that no longer opens it all still win.
    const now = deps.decide(tool.capability);
    if (now.action === "deny") {
      convo.push(toolMessage(call, `Refused: ${now.reason}`, true));
      await deps.journal({ capability: tool.capability, decision: "deny", reason: now.reason, payload: checked.args });
      deps.emit({ t: "step", id: call.id, name: call.name, args: checked.args, state: "denied", summary: now.reason });
    } else {
      await run(call, tool, checked.args, convo, deps, true);
    }
  }

  const paused = await answer(rest, convo, deps);
  if (paused >= 0) return { messages: convo, stop: "approval", steps: 0, route: deps.stickTo };
  return loop(convo, deps);
}
