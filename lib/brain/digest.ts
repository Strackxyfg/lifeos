import { computeFocus, type FocusReason } from "./focus";
import type { LinkLike, NoteLike } from "./graph";

/**
 * What the second brain says about today and this week, in numbers and
 * titles — the ground truth the daily summary and the weekly review are
 * written from. They used to know only projects, deals and money, as if the
 * brain did not exist.
 *
 * Pure and deterministic, so the computed fallback and the model's facts
 * can never disagree.
 */
export interface BrainDigest {
  /** What deserves attention now, in order. */
  focus: { title: string; reason: FocusReason }[];
  openGoals: number;
  /** Goals nothing moves forward yet. */
  goalsWithoutStep: string[];
  /** Pairs of notes that pull against each other. */
  tensions: { a: string; b: string; reason: string | null }[];
  capturedThisWeek: number;
  connectedThisWeek: number;
  /** Connections drawn by LifeOS or the agent, not yet reviewed. */
  awaitingReview: number;
}

const WEEK = 7 * 86_400_000;

export function brainDigest(input: {
  notes: NoteLike[];
  links: (LinkLike & { createdAt?: string })[];
  now: Date;
}): BrainDigest {
  const { notes, links, now } = input;
  const byId = new Map(notes.map((n) => [n.id, n]));
  const since = now.getTime() - WEEK;
  const recent = (iso?: string) => !!iso && Date.parse(iso) >= since;

  const focus = computeFocus({ notes, links, now, limit: 5 });
  return {
    focus: focus
      .slice(0, 3)
      .map((f) => ({ title: byId.get(f.id)?.title ?? "", reason: f.reason }))
      .filter((f) => f.title),
    openGoals: notes.filter((n) => n.category === "goals" && !n.done).length,
    goalsWithoutStep: focus
      .filter((f) => f.reason.code === "goalWithoutAction")
      .map((f) => byId.get(f.id)?.title ?? "")
      .filter(Boolean),
    tensions: links
      .filter((l) => l.kind === "tension")
      .map((l) => ({ a: byId.get(l.fromId)?.title ?? "", b: byId.get(l.toId)?.title ?? "", reason: l.reason ?? null }))
      .filter((t) => t.a && t.b)
      .slice(0, 3),
    capturedThisWeek: notes.filter((n) => recent(n.createdAt)).length,
    connectedThisWeek: links.filter((l) => recent(l.createdAt)).length,
    awaitingReview: links.filter((l) => l.origin === "ai" || l.origin === "agent").length,
  };
}

/**
 * The digest as facts for a model. Titles are quoted verbatim so the model
 * names the person's own notes instead of paraphrasing them into something
 * they did not write.
 */
export function digestFacts(d: BrainDigest, reason: (r: FocusReason) => string): string {
  const q = (s: string) => `"${s}"`;
  return [
    d.focus.length
      ? `Second brain — focus, in order:\n${d.focus.map((f) => `- ${q(f.title)} — ${reason(f.reason)}`).join("\n")}`
      : "Second brain — nothing pressing in the focus list.",
    `Open goals: ${d.openGoals}.` +
      (d.goalsWithoutStep.length ? ` Goals with no next step: ${d.goalsWithoutStep.map(q).join(", ")}.` : ""),
    d.tensions.length
      ? `Tensions to resolve: ${d.tensions.map((t) => `${q(t.a)} vs ${q(t.b)}${t.reason ? ` (${t.reason})` : ""}`).join("; ")}.`
      : "No tension between notes.",
    `This week: ${d.capturedThisWeek} notes captured, ${d.connectedThisWeek} connections drawn` +
      (d.awaitingReview ? `, ${d.awaitingReview} awaiting the owner's review.` : "."),
  ].join("\n");
}
