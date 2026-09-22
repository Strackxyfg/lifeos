import { neighborsOf, type LinkLike, type NoteLike } from "./graph";

/**
 * What deserves your attention now — computed from your own notes.
 *
 * This replaces a hardcoded paragraph that told every user, whatever they had
 * written, that "the investor deck is your only at-risk item". A second brain
 * that invents your priorities is worse than one that has none.
 *
 * Every entry carries the reason it was chosen, as structured data rather than
 * prose, so the UI can phrase it in the reader's language and a person can
 * always see *why* something is on the list.
 */

export type FocusReason =
  /** An open next step that serves one of your goals. */
  | { code: "servesGoal"; goal: string; days: number }
  /** An open next step, waiting. */
  | { code: "waiting"; days: number }
  /** A goal with no open next step pointing at it — no path forward. */
  | { code: "goalWithoutAction" }
  /** A recent idea not yet linked to anything, before it gets lost. */
  | { code: "freshIdea"; days: number };

export interface FocusEntry {
  id: string;
  reason: FocusReason;
  score: number;
}

const DAY = 86_400_000;

/** Whole days since `iso`, never negative (clock skew, future-dated rows). */
export function ageInDays(iso: string, now: Date): number {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return 0;
  return Math.max(0, Math.floor((now.getTime() - t) / DAY));
}

/** Ideas older than this have had their chance to be acted on. */
export const FRESH_IDEA_DAYS = 14;

/**
 * Ranking, in order of what a thoughtful chief of staff would raise first:
 *   1. next steps that move a goal forward — the reason goals exist;
 *   2. goals with no next step at all — a destination with no road;
 *   3. other next steps, oldest first — things quietly rotting;
 *   4. recent unlinked ideas — easiest to lose, cheapest to keep.
 * Age adds weight within a band but can never lift an entry into the next.
 */
export function computeFocus(input: {
  notes: NoteLike[];
  links: LinkLike[];
  now: Date;
  limit?: number;
}): FocusEntry[] {
  const { notes, now, limit = 5 } = input;
  // A step "in tension" with a goal pulls against it; it does not serve it.
  const links = input.links.filter((l) => (l.kind ?? "related") !== "tension");
  const byId = new Map(notes.map((n) => [n.id, n]));
  const out: FocusEntry[] = [];

  const openSteps = notes.filter((n) => n.category === "next" && !n.done);
  const goals = notes.filter((n) => n.category === "goals" && !n.done);

  for (const step of openSteps) {
    const days = ageInDays(step.createdAt, now);
    const linkedGoals = [...neighborsOf(step.id, links)]
      .map((id) => byId.get(id))
      .filter((n): n is NoteLike => !!n && n.category === "goals" && !n.done)
      .sort((a, b) => a.title.localeCompare(b.title));

    if (linkedGoals.length > 0) {
      out.push({
        id: step.id,
        reason: { code: "servesGoal", goal: linkedGoals[0].title, days },
        score: 300 + Math.min(days, 60),
      });
    } else {
      out.push({ id: step.id, reason: { code: "waiting", days }, score: 100 + Math.min(days, 60) });
    }
  }

  for (const goal of goals) {
    const hasAction = [...neighborsOf(goal.id, links)].some((id) => {
      const n = byId.get(id);
      return !!n && n.category === "next" && !n.done;
    });
    if (!hasAction) out.push({ id: goal.id, reason: { code: "goalWithoutAction" }, score: 200 });
  }

  for (const idea of notes) {
    if (idea.category !== "ideas" || idea.done) continue;
    const days = ageInDays(idea.createdAt, now);
    if (days >= FRESH_IDEA_DAYS) continue;
    // Any connection, tension included, means the idea is no longer loose.
    if (neighborsOf(idea.id, input.links).size > 0) continue;
    out.push({ id: idea.id, reason: { code: "freshIdea", days }, score: 50 - days });
  }

  // Deterministic: score, then oldest first, then id — never input order.
  return out
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const ca = byId.get(a.id)?.createdAt ?? "";
      const cb = byId.get(b.id)?.createdAt ?? "";
      return ca.localeCompare(cb) || a.id.localeCompare(b.id);
    })
    .slice(0, limit);
}
