import type { AgentEvent, StepState, StopKind } from "@/lib/agent/loop";
import type { Source } from "@/lib/agent/tools";
import type { RiskTier } from "@/lib/agent/capabilities";

/**
 * The conversation as the page shows it, built from the agent's events.
 * Pure, so what the stream does to the page is tested without a browser.
 */

export type Segment =
  | { kind: "text"; text: string }
  | { kind: "step"; id: string; name: string; args: Record<string, unknown>; state: StepState; summary?: string; sources?: Source[]; flagged?: boolean; subs?: SubAgent[] }
  | {
      kind: "approval";
      id: string;
      name: string;
      capability: string;
      tier: RiskTier;
      args: Record<string, unknown>;
      status: "pending" | "approved" | "declined";
    };

export interface AgentTurn {
  role: "agent";
  segments: Segment[];
  /** "model · Provider" of the last model turn. */
  model?: string;
  provider?: string;
  stop?: StopKind;
  steps: number;
  error?: string;
  /** What the models reported this turn cost, in US dollars, when they report it. */
  cost?: number;
  /** What they wrote may be heavy for them: the page shows who to call. */
  care?: "distress" | "crisis";
}

/** One research sub-agent, as its research step shows it. */
export interface SubAgent {
  n: number;
  title: string;
  state: "running" | "done" | "error";
  tool?: { name: string; args: Record<string, unknown> };
  steps: number;
  sources?: Source[];
}

export type Turn = { role: "user"; text: string } | AgentTurn;

export const emptyAgentTurn = (): AgentTurn => ({ role: "agent", segments: [], steps: 0 });

/** One event applied to the agent's turn. Returns a new turn. */
export function applyEvent(turn: AgentTurn, e: AgentEvent): AgentTurn {
  const segments = [...turn.segments];
  switch (e.t) {
    case "text": {
      const last = segments[segments.length - 1];
      if (last?.kind === "text") segments[segments.length - 1] = { kind: "text", text: last.text + e.d };
      else segments.push({ kind: "text", text: e.d });
      return { ...turn, segments };
    }
    case "step": {
      const at = segments.findIndex((s) => s.kind === "step" && s.id === e.id);
      const prior = at >= 0 ? (segments[at] as Extract<Segment, { kind: "step" }>) : null;
      const step: Segment = {
        kind: "step",
        id: e.id,
        name: e.name,
        args: e.args,
        state: e.state,
        summary: e.summary,
        sources: e.sources,
        ...(e.flagged ? { flagged: true } : {}),
        ...(prior?.subs ? { subs: prior.subs } : {}),
      };
      // A step that follows the owner's decision replaces nothing: the card stays, the step follows it.
      if (at >= 0) segments[at] = step;
      else segments.push(step);
      return { ...turn, segments };
    }
    case "approval": {
      if (segments.some((s) => s.kind === "approval" && s.id === e.id)) return turn;
      segments.push({ kind: "approval", id: e.id, name: e.name, capability: e.capability, tier: e.tier, args: e.args, status: "pending" });
      return { ...turn, segments };
    }
    case "model":
      return { ...turn, model: e.model, provider: e.provider, ...(typeof e.cost === "number" ? { cost: (turn.cost ?? 0) + e.cost } : {}) };
    case "care":
      return { ...turn, care: e.level };
    case "sub": {
      const at = segments.findIndex((x) => x.kind === "step" && x.id === e.call);
      if (at < 0) return turn;
      const step = segments[at] as Extract<Segment, { kind: "step" }>;
      const sub: SubAgent = { n: e.n, title: e.title, state: e.state, steps: e.steps, ...(e.tool ? { tool: e.tool } : {}), ...(e.sources ? { sources: e.sources } : {}) };
      const subs = [...(step.subs ?? [])];
      const i = subs.findIndex((x) => x.n === e.n);
      if (i >= 0) subs[i] = { ...subs[i], ...sub, tool: e.state === "running" ? (e.tool ?? subs[i].tool) : undefined };
      else subs.push(sub);
      subs.sort((a, b) => a.n - b.n);
      segments[at] = { ...step, subs };
      return { ...turn, segments };
    }
    case "end":
      return { ...turn, stop: e.stop, steps: turn.steps + e.steps };
    case "error":
      return { ...turn, error: e.code };
    default:
      return turn;
  }
}

/** The owner's decision, shown on the card at once. */
export function decide(turn: AgentTurn, id: string, approve: boolean): AgentTurn {
  return {
    ...turn,
    error: undefined,
    stop: undefined,
    segments: turn.segments.map((s) => (s.kind === "approval" && s.id === id ? { ...s, status: approve ? "approved" : "declined" } : s)),
  };
}

/** The notes and pages the turn's steps relied on, once each — notes first. */
export function sourcesOf(turn: AgentTurn): Source[] {
  const seen = new Map<string, Source>();
  for (const s of turn.segments) {
    if (s.kind !== "step" || s.state !== "done") continue;
    for (const src of s.sources ?? []) {
      const key = src.id ? `n:${src.id}` : src.url ? `u:${src.url}` : null;
      if (key && !seen.has(key)) seen.set(key, src);
    }
  }
  const all = [...seen.values()];
  return [...all.filter((x) => x.id), ...all.filter((x) => !x.id)].slice(0, 12);
}

/** The text the agent wrote, all of it — what "read aloud" reads. */
export const textOf = (turn: AgentTurn) =>
  turn.segments
    .flatMap((s) => (s.kind === "text" ? [s.text.trim()] : []))
    .filter(Boolean)
    .join("\n\n");

/** The card still waiting for the owner, if any. */
export const pendingApproval = (turns: Turn[]) => {
  const last = turns[turns.length - 1];
  if (!last || last.role !== "agent") return null;
  return last.segments.find((s): s is Extract<Segment, { kind: "approval" }> => s.kind === "approval" && s.status === "pending") ?? null;
};

/** A step's line: the tool's words, filled with its arguments (short). */
export function stepLabel(templates: Record<string, string>, name: string, args: Record<string, unknown>): string {
  const template = templates[name] ?? templates.unknown ?? "{name}";
  return template.replace(/\{(\w+)\}/g, (_, k: string) => {
    if (k === "name") return name;
    const v = args[k];
    if (v === undefined || v === null || v === "") return "…";
    let s = String(v);
    if (k === "url") {
      try {
        s = new URL(s).host;
      } catch {
        /* keep as given */
      }
    }
    if (k === "when") s = s.replace("T", " ");
    return s.length > 60 ? `${s.slice(0, 59)}…` : s;
  });
}
