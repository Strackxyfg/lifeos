import type { AgentEvent, StepState, StopKind } from "@/lib/agent/loop";
import type { Source } from "@/lib/agent/tools";
import type { RiskTier } from "@/lib/agent/capabilities";

/**
 * The conversation as the page shows it, built from the agent's events.
 * Pure, so what the stream does to the page is tested without a browser.
 */

export type Segment =
  | { kind: "text"; text: string }
  | { kind: "step"; id: string; name: string; args: Record<string, unknown>; state: StepState; summary?: string; sources?: Source[]; flagged?: boolean }
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
      const step: Segment = { kind: "step", id: e.id, name: e.name, args: e.args, state: e.state, summary: e.summary, sources: e.sources, ...(e.flagged ? { flagged: true } : {}) };
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
      return { ...turn, model: e.model, provider: e.provider };
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

/** The notes the turn's steps relied on, once each. */
export function sourcesOf(turn: AgentTurn): Source[] {
  const seen = new Map<string, Source>();
  for (const s of turn.segments) if (s.kind === "step" && s.state === "done") for (const src of s.sources ?? []) if (!seen.has(src.id)) seen.set(src.id, src);
  return [...seen.values()].slice(0, 8);
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
